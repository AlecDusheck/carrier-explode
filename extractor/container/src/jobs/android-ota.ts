/**
 * android.ota: one device's OTA of one build -> its etc/CarrierSettings files,
 * stored content-addressed. others.pb is split into its CarrierSettings, each a
 * source of its own carrying others.pb's version.
 */

import { decodeCarrierSettings, splitMultiCarrierSettings } from "../../../../src/lib/decode/android/index.ts";
import {
  FsNotFoundError, openFilesystem, openPayload, openRemoteZip, partitionReader, type Filesystem,
} from "../../../../src/lib/firmware/index.ts";
import { sourceKey } from "../../../../src/lib/schema/index.ts";
import type { Origin } from "../../../../src/lib/storage/keys.ts";
import type { JobContext, JobOutput } from "../job.ts";
import { payloadCodecs } from "./android-codecs.ts";

const DIR = "etc/CarrierSettings";
const DEFAULTS: ReadonlySet<string> = new Set(["default.pb", "no_sim.pb"]);

type OtaOutput = JobOutput<"android.ota">;
type OtaFile = OtaOutput["files"][number];

interface SettingsFile {
  readonly bytes: Uint8Array;
  readonly source: string;
  readonly version: string;
  readonly path: string;
}

export class AndroidOtaError extends Error {
  override name = "AndroidOtaError";
}

/** File names in etc/CarrierSettings, sorted; undefined when there is no such directory (tablets). */
async function carrierSettingsDir(fs: Filesystem): Promise<string[] | undefined> {
  try {
    return (await fs.readdir(DIR)).filter((e) => e.kind === "file").map((e) => e.name).sort();
  } catch (e) {
    if (e instanceof FsNotFoundError) return undefined;
    throw e;
  }
}

/** A CarrierSettings file, which must be named after its canonical name. */
function settingsFile(name: string, bytes: Uint8Array): SettingsFile {
  const { canonicalName, version } = decodeCarrierSettings(bytes);
  if (canonicalName === undefined || `${canonicalName}.pb` !== name) throw new AndroidOtaError(`${name} names itself "${canonicalName}"`);
  if (version === undefined) throw new AndroidOtaError(`${name} has no version`);
  const kind = DEFAULTS.has(name) ? "default" : "carrier";
  return { bytes, source: sourceKey({ platform: "android", kind, name: canonicalName }), version, path: name };
}

/** others.pb's parts, byte for byte, versioned by others.pb. */
function othersParts(bytes: Uint8Array): SettingsFile[] {
  const { version, settings } = splitMultiCarrierSettings(bytes);
  if (version === undefined) throw new AndroidOtaError("others.pb has no version");
  return settings.map((part) => {
    const cs = decodeCarrierSettings(part);
    if (!cs.canonicalName) throw new AndroidOtaError("others.pb: a setting without a canonical name");
    if (cs.version !== undefined) throw new AndroidOtaError(`others.pb: ${cs.canonicalName} carries its own version`);
    return { bytes: part, source: sourceKey({ platform: "android", kind: "carrier", name: cs.canonicalName }), version, path: `others.pb#${cs.canonicalName}` };
  });
}

export async function androidOta(ctx: JobContext<"android.ota">): Promise<OtaOutput> {
  const { build, device, url } = ctx.spec.params;
  const zip = await openRemoteZip(url);
  const fs = await openFilesystem(partitionReader(await openPayload(zip, { decompressors: payloadCodecs }), "product"));
  const names = await carrierSettingsDir(fs);
  if (!names) {
    ctx.log(`${device} ${build}: product has no ${DIR}`);
    return { build, device, carrierList: null, files: [] };
  }
  const origin = (path: string): Origin => ({ via: "image", release: build, device, path: `product/${DIR}/${path}` });
  const files: OtaFile[] = [];
  const sources = new Set<string>();
  const store = async (file: SettingsFile): Promise<void> => {
    if (sources.has(file.source)) throw new AndroidOtaError(`${file.source} appears twice in ${DIR}`);
    sources.add(file.source);
    const sha = await ctx.r2.putObj(file.bytes, { kind: "android.carrier-settings", origin: origin(file.path) });
    files.push({ source: file.source, sha, version: file.version, size: file.bytes.length });
  };

  let carrierList: string | null = null;
  for (const [i, name] of names.entries()) {
    if (i % 100 === 0) await ctx.progress(i, names.length, name);
    if (!name.endsWith(".pb")) throw new AndroidOtaError(`${DIR}/${name} is not a .pb`);
    const bytes = await fs.readFile(`${DIR}/${name}`);
    if (name === "carrier_list.pb") carrierList = await ctx.r2.putObj(bytes, { kind: "android.carrier-list", origin: origin(name) });
    else if (name === "others.pb") for (const part of othersParts(bytes)) await store(part);
    else await store(settingsFile(name, bytes));
  }
  if (carrierList === null) throw new AndroidOtaError(`${DIR} has no carrier_list.pb`);
  await ctx.progress(names.length, names.length);
  ctx.log(`${device} ${build}: ${files.length} sources; fetched ${zip.source.stats.bytes} bytes in ${zip.source.stats.requests} requests`);
  return { build, device, carrierList, files };
}
