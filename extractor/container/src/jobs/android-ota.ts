/**
 * android.ota: one device's full OTA of one build -> its CarrierSettings,
 * read over HTTP Range requests (about 60 MB of a 3+ GB zip), stored
 * content-addressed. The release record is android.release's job.
 *
 *   OTA zip -> payload.bin (stored) -> product partition (ext4 or EROFS) -> etc/CarrierSettings/*.pb
 *
 * Sources per file:
 *   <canonical>.pb      android:carrier:<canonical>, stored as shipped
 *   default.pb, no_sim.pb  android:default:<canonical>
 *   others.pb           expanded: each CarrierSettings inside (all have canonical names, none
 *                       has its own file or version) becomes android:carrier:<name>, stored as
 *                       its exact bytes. Its version is others.pb's, recorded in the output
 *                       only: stamping it into the bytes would make every part change with
 *                       every others.pb bump, and differ across devices whose parts agree.
 *   carrier_list.pb     not a source: the release's carrierList
 * A device with no etc/CarrierSettings (Pixel Tablet) succeeds with no files.
 */

import { decodeCarrierSettings, splitMultiCarrierSettings } from "../../../../src/lib/decode/android/index.ts";
import {
  FsNotFoundError, openFilesystem, openPayload, openRemoteZip, partitionReader, type Filesystem,
} from "../../../../src/lib/firmware/index.ts";
import { sourceKey } from "../../../../src/lib/schema/types.ts";
import type { JobContext, JobOutput } from "../job.ts";
import { payloadCodecs } from "./android-codecs.ts";

const DIR = "etc/CarrierSettings";
const DEFAULTS: ReadonlySet<string> = new Set(["default.pb", "no_sim.pb"]);

type OtaOutput = JobOutput<"android.ota">;
type OtaFile = OtaOutput["files"][number];

export class AndroidOtaError extends Error {
  override name = "AndroidOtaError";
}

/** File names in etc/CarrierSettings, sorted; undefined when the directory does not exist. */
async function carrierSettingsDir(fs: Filesystem): Promise<string[] | undefined> {
  try {
    const entries = await fs.readdir(DIR);
    return entries.filter((e) => e.kind === "file").map((e) => e.name).sort();
  } catch (e) {
    // Absent is a valid answer (tablets); anything else is a real failure.
    if (e instanceof FsNotFoundError) return undefined;
    throw e;
  }
}

export async function androidOta(ctx: JobContext<"android.ota">): Promise<OtaOutput> {
  const { build, device, url } = ctx.spec.params;
  const zip = await openRemoteZip(url);
  const payload = await openPayload(zip, { decompressors: payloadCodecs });
  const fs = await openFilesystem(partitionReader(payload, "product"));
  const names = await carrierSettingsDir(fs);
  if (!names) {
    ctx.log(`${device} ${build}: product has no ${DIR}`);
    return { build, device, carrierList: null, files: [] };
  }
  const origin = (path: string): { url: string; release: string; path: string; device: string } => ({ url, release: build, path: `product/${DIR}/${path}`, device });
  const files: OtaFile[] = [];
  let carrierList: string | null = null;

  const store = async (bytes: Uint8Array, source: string, version: string, path: string): Promise<void> => {
    const sha = await ctx.r2.putObj(bytes, { kind: "android.carrier_settings", origin: origin(path) });
    files.push({ source, sha, version, size: bytes.length });
  };

  for (const [i, name] of names.entries()) {
    if (i % 100 === 0) await ctx.progress(i, names.length, name);
    if (!name.endsWith(".pb")) {
      ctx.log(`skipping ${name}: not a .pb`);
      continue;
    }
    const bytes = await fs.readFile(`${DIR}/${name}`);
    if (name === "carrier_list.pb") {
      carrierList = await ctx.r2.putObj(bytes, { kind: "android.carrier_list", origin: origin(name) });
    } else if (name === "others.pb") {
      const others = splitMultiCarrierSettings(bytes);
      const version = others.version ?? "";
      for (const part of others.settings) {
        const cs = decodeCarrierSettings(part);
        if (!cs.canonicalName) throw new AndroidOtaError(`${name}: a setting without a canonical name`);
        await store(part, sourceKey({ platform: "android", kind: "carrier", name: cs.canonicalName }), cs.version ?? version, `${name}#${cs.canonicalName}`);
      }
    } else {
      const cs = decodeCarrierSettings(bytes);
      const stem = name.slice(0, -".pb".length);
      if (cs.canonicalName && cs.canonicalName !== stem) ctx.log(`${name} names itself ${cs.canonicalName}; keyed by the canonical name`);
      const kind = DEFAULTS.has(name) ? "default" : "carrier";
      await store(bytes, sourceKey({ platform: "android", kind, name: cs.canonicalName || stem }), cs.version ?? "", name);
    }
  }

  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.source)) throw new AndroidOtaError(`${device} ${build}: ${f.source} appears twice (a file and an others.pb entry?)`);
    seen.add(f.source);
  }
  await ctx.progress(names.length, names.length);
  ctx.log(`${device} ${build}: ${files.length} sources from ${names.length} files; fetched ${zip.source.stats.bytes} bytes in ${zip.source.stats.requests} requests`);
  return { build, device, carrierList, files };
}
