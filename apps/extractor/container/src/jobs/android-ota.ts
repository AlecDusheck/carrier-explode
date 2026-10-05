/**
 * android.ota: one device's OTA of one build -> its etc/CarrierSettings files,
 * stored content-addressed. others.pb is split into its CarrierSettings, each a
 * source of its own carrying others.pb's version.
 */

import { decodeCarrierSettings, splitMultiCarrierSettings } from "@carrier-explode/decode-android";
import {
  FsNotFoundError, MissingPartitionError, openFilesystem, openPartition, openPayload, openRemoteZip, type Filesystem, type Payload,
} from "@carrier-explode/firmware";
import { sourceKey, type SourceKey } from "@carrier-explode/schema";
import type { ObjClaim, Origin } from "@carrier-explode/storage";
import { allOrThrow, fanOut } from "../../../src/fan-out.ts";
import type { JobContext } from "../job.ts";
import type { JobOutput } from "../../../src/jobs.ts";
import { READ_CONCURRENCY } from "./shared/limits.ts";
import { payloadCodecs } from "./android-codecs.ts";

const DIR = "etc/CarrierSettings";
const PROGRESS_EVERY = 100;
const DEFAULTS: ReadonlySet<string> = new Set(["default.pb", "no_sim.pb"]);
/** Not a CarrierSettings: the carrier data release the directory was built from, on some builds. */
const LABEL = "label";

type OtaOutput = JobOutput<"android.ota">;
type OtaFile = OtaOutput["files"][number];

export interface SettingsFile {
  /** A file of its own, or a part of others.pb. */
  readonly in: "file" | "others.pb";
  readonly bytes: Uint8Array;
  readonly source: SourceKey<"android">;
  readonly version: string;
  readonly path: string;
}

export class AndroidOtaError extends Error {
  override name = "AndroidOtaError";
}

/** Where CarrierSettings are: the product partition's etc/, or before Pixels had one (Android 10-11 on the Pixel 1 and 2), system's /system/product/etc/. */
interface SettingsRoot {
  readonly fs: Filesystem;
  readonly dir: string;
  /** The directory as an image path, for origins. */
  readonly image: string;
}

async function settingsRoot(payload: Payload): Promise<SettingsRoot> {
  try {
    return { fs: await openFilesystem(await openPartition(payload, "product")), dir: DIR, image: `product/${DIR}` };
  } catch (e) {
    if (!(e instanceof MissingPartitionError)) throw e;
    const dir = `system/product/${DIR}`;
    return { fs: await openFilesystem(await openPartition(payload, "system")), dir, image: `system/${dir}` };
  }
}

/** File names in the CarrierSettings directory, sorted; undefined when there is none (tablets, Android 9). */
async function carrierSettingsDir(root: SettingsRoot): Promise<string[] | undefined> {
  try {
    return (await root.fs.readdir(root.dir)).filter((e) => e.kind === "file").map((e) => e.name).sort();
  } catch (e) {
    if (e instanceof FsNotFoundError) return undefined;
    throw e;
  }
}

/** The directory's CarrierSettings files: everything but the label, all .pb. */
export function settingsNames(names: readonly string[], image: string): string[] {
  return names.filter((name) => {
    if (name === LABEL) return false;
    if (!name.endsWith(".pb")) throw new AndroidOtaError(`${image}/${name} is not a .pb`);
    return true;
  });
}

/** A CarrierSettings file, which must be named after its canonical name. */
function settingsFile(name: string, bytes: Uint8Array): SettingsFile {
  const { canonicalName, version } = decodeCarrierSettings(bytes);
  if (`${canonicalName}.pb` !== name) throw new AndroidOtaError(`${name} names itself "${canonicalName}"`);
  if (version === undefined) throw new AndroidOtaError(`${name} has no version`);
  const kind = DEFAULTS.has(name) ? "default" : "carrier";
  return { in: "file", bytes, source: sourceKey({ platform: "android", kind, name: canonicalName }), version, path: name };
}

/** others.pb's parts, byte for byte, versioned by others.pb. */
function othersParts(bytes: Uint8Array): SettingsFile[] {
  const { version, settings } = splitMultiCarrierSettings(bytes);
  if (version === undefined) throw new AndroidOtaError("others.pb has no version");
  return settings.map((part) => {
    const cs = decodeCarrierSettings(part);
    if (cs.version !== undefined) throw new AndroidOtaError(`others.pb: ${cs.canonicalName} carries its own version`);
    return { in: "others.pb", bytes: part, source: sourceKey({ platform: "android", kind: "carrier", name: cs.canonicalName }), version, path: `others.pb#${cs.canonicalName}` };
  });
}

/** One file per source. others.pb holds carriers without a file of their own, so a part named like a file is left out (Android 12-13's telenor_se). */
export function unshadowed(files: readonly SettingsFile[], leftOut: (f: SettingsFile) => void): SettingsFile[] {
  const own = new Set(files.filter((f) => f.in === "file").map((f) => f.source));
  const kept = files.filter((f) => {
    if (f.in === "file" || !own.has(f.source)) return true;
    leftOut(f);
    return false;
  });
  const duplicate = kept.find((f, i) => kept.findIndex((g) => g.source === f.source) !== i);
  if (duplicate) {
    const paths = kept.filter((f) => f.source === duplicate.source).map((f) => f.path);
    throw new AndroidOtaError(`${duplicate.source} appears more than once in ${DIR}: ${paths.join(", ")}`);
  }
  return kept;
}

export async function androidOta(ctx: JobContext<"android.ota">): Promise<OtaOutput> {
  const { build, device, url } = ctx.spec.params;
  const zip = await openRemoteZip(url);
  const root = await settingsRoot(await openPayload(zip, { decompressors: payloadCodecs }));
  const names = await carrierSettingsDir(root);
  if (!names) {
    ctx.log(`${device} ${build}: no ${root.image}`);
    return { build, device, carrierList: null, files: [] };
  }
  const origin = (path: string): Origin => ({ kind: "image", release: build, device, path: `${root.image}/${path}` });

  // Read everything first (the partition's ops are cached), then upload in parallel: each putObj is four round trips.
  const read: SettingsFile[] = [];
  let listBytes: Uint8Array | undefined;
  for (const name of settingsNames(names, root.image)) {
    const bytes = await root.fs.readFile(`${root.dir}/${name}`);
    if (name === "carrier_list.pb") listBytes = bytes;
    else if (name === "others.pb") read.push(...othersParts(bytes));
    else read.push(settingsFile(name, bytes));
  }
  if (listBytes === undefined) throw new AndroidOtaError(`${DIR} has no carrier_list.pb`);
  const settings = unshadowed(read, (f) => ctx.log(`${device} ${build}: ${f.path} left out: ${f.source} has a file of its own`));

  const carrierList = await ctx.r2.putObj(listBytes, { kind: "android.carrier-list", origin: origin("carrier_list.pb") } satisfies ObjClaim);
  let done = 0;
  const files = allOrThrow("carrier settings", await fanOut(settings, READ_CONCURRENCY, async (file): Promise<OtaFile> => {
    const sha = await ctx.r2.putObj(file.bytes, { kind: "android.carrier-settings", origin: origin(file.path) } satisfies ObjClaim);
    if (++done % PROGRESS_EVERY === 0) await ctx.progress(done, settings.length, file.source);
    return { source: file.source, sha, version: file.version, size: file.bytes.length };
  }));
  await ctx.progress(settings.length, settings.length);
  ctx.log(`${device} ${build}: ${files.length} sources; fetched ${zip.source.stats.bytes} bytes in ${zip.source.stats.requests} requests`);
  return { build, device, carrierList, files };
}
