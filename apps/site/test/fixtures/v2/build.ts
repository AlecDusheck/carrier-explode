/**
 * A small v2 bucket from the repo's real bundles, for the site's local R2:
 *   pnpm --filter @carrier-explode/site exec tsx test/fixtures/v2/build.ts <out>
 *   pnpm --filter @carrier-explode/extractor seed --r2 <out>
 * iPhone carriers and countries on two images and one OTA file, with one modem
 * package's phones; Pixel carrier settings on two builds and five devices, and a
 * modem configuration per family; the index from the schema's own buildIndexes,
 * as the D1 statements a publish would apply, so the shapes are the contract's.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha1Hex, sha256Hex } from "@carrier-explode/binary";
import { decodeCarrierList, decodeCarrierSettings } from "@carrier-explode/decode-android";
import { contentId, decodedPlist, decodeFile, openIpcc, parseManifest } from "@carrier-explode/decode-ios";
import {
  androidProfile, buildIndexes, indexModemConfig, indexProfile, iosProfile, manifestSims, modemConfig, sourceKey,
  type AndroidArtifact, type AndroidModem, type AndroidRelease, type AppleArtifact, type AppleRelease, type ImageModem, type ModemConfig, type OtaFile, type Profile, type SourceKey, type SourceRef,
} from "@carrier-explode/schema";
import { delta, emptyLive, indexRows, INDEX_STATEMENTS } from "@carrier-explode/db";
import { keys } from "@carrier-explode/storage";
import { ANDROID_FILES, CARRIER_LIST } from "./android.ts";
import { MODEM_FIXTURES } from "./modem.ts";
import { DEVICE_LABELS, DEVICES, PRODUCTS } from "../devices.ts";

const usage = (): never => {
  throw new Error("usage: build.ts <out dir>");
};
const out = process.argv[2] || usage();

/** decode-ios owns the .ipcc and manifest fixtures. */
const FIXTURES = join(import.meta.dirname, "../../../../../packages/decode-ios/test/fixtures");
const NOW = "2026-10-01T00:00:00Z";

async function put(key: string, body: Uint8Array | string): Promise<void> {
  const file = join(out, key);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
}
const putJson = (key: string, value: unknown): Promise<void> => put(key, JSON.stringify(value));

const profiles = new Map<string, Profile>();
const modemConfigs = new Map<string, ModemConfig>();

async function storeObj(bytes: Uint8Array, kind: string): Promise<string> {
  const sha = await sha256Hex(bytes);
  await put(keys.obj(sha), bytes);
  await putJson(keys.meta(sha), { kind, origin: { kind: "download", url: "fixture" }, sha, size: bytes.length, storedAt: NOW });
  return sha;
}

const ios = (kind: "carrier" | "country", name: string): SourceRef<"ios"> => ({ platform: "ios", kind, name });

/** An iPhone image's bundles: fixture file per source. */
const IMAGES = [
  {
    id: "24A437", version: "27.0", label: "27.0", released: "2026-09-15",
    bundles: [
      [ios("carrier", "ATT_US"), "carrier-att.ipcc"],
      [ios("carrier", "Verizon_LTE_US"), "carrier-verizon.ipcc"],
      [ios("carrier", "BhartiAirtel_in"), "carrier-airtel-in.ipcc"],
      [ios("country", "UnitedStates"), "country-us.ipcc"],
      [ios("country", "Germany"), "country-germany.ipcc"],
    ],
  },
  {
    id: "23E246", version: "26.4", label: "26.4", released: "2026-03-24",
    bundles: [
      [ios("carrier", "ATT_US"), "carrier-att-2009.ipcc"],
      [ios("carrier", "Verizon_LTE_US"), "carrier-verizon.ipcc"],
      [ios("country", "UnitedStates"), "country-us.ipcc"],
    ],
  },
] as const;

async function appleArtifact(ref: SourceRef, file: string): Promise<AppleArtifact> {
  const bytes = new Uint8Array(await readFile(join(FIXTURES, file)));
  const bundle = openIpcc(bytes);
  const info = decodedPlist(decodeFile(bundle, "Info.plist"));
  const version = info !== null && typeof info === "object" && "CFBundleVersion" in info ? String(info.CFBundleVersion) : "0";
  const sha = await storeObj(bytes, "apple.ipcc");
  profiles.set(sha, iosProfile(bundle, ref, sha, PRODUCTS));
  return { sha, version, size: bytes.length, cid: await contentId(bundle) };
}

/** The iPhone 15 family's modem package, so the Modem tab has phones for ATT_US's overrides_D83_D84_D37_D38.der.pri. */
const MAV22: ImageModem = {
  family: "Mav22",
  devices: ["iPhone15,4", "iPhone15,5", "iPhone16,1", "iPhone16,2"],
  package: { kind: "bbfw", name: "Mav22-3.80.01.Release.bbfw", sha: await sha256Hex(new TextEncoder().encode("Mav22")), size: 88_000_000, crc32: "00000000" },
};

const appleReleases: AppleRelease[] = [];
for (const image of IMAGES) {
  const sources: Record<SourceKey<"ios">, AppleArtifact> = {};
  for (const [ref, file] of image.bundles) sources[sourceKey(ref)] = await appleArtifact(ref, file);
  appleReleases.push({
    platform: "ios", id: image.id, version: image.version, label: image.label, prerelease: false, released: image.released,
    devices: ["iPhone17,1", "iPhone18,1"], extractedAt: NOW, sources, modems: image.id === "24A437" ? [MAV22] : [],
  });
}

// The iPad's OTA file, stored as every OTA file is: the iPhone bundle's bytes stand in.
const ipad = await appleArtifact(ios("carrier", "ATT_US"), "carrier-att.ipcc");
const OTA: OtaFile[] = [{
  url: "https://updates.cdn-apple.com/2026FallFCS/fullrestores/ATT_US_iPad.ipcc",
  version: "72.0",
  published: "2026-09-20",
  digests: {},
  sha: ipad.sha,
  cid: ipad.cid,
  listings: [{ source: "ipados:carrier:ATT_US", os: "27.0", firstSeenAt: NOW, lastSeenAt: NOW, live: true }],
}];

const listBytes = CARRIER_LIST;
const list = decodeCarrierList(listBytes);
const listSha = await storeObj(listBytes, "android.carrier-list");

/** Pixel builds: per device, the files it carries. */
const BUILDS = [
  { id: "BP2A.250605.031", version: "16", patch: "2025-06", released: "2025-06-10", devices: ["tokay", "caiman"], generation: 0 },
  { id: "CP3A.260905.009", version: "16", patch: "2026-09", released: "2026-09-02", devices: ["redfin", "tokay", "caiman", "frankel", "cubs"], generation: 1 },
] as const;

/** The newest build's modem configurations, each stored and normalised as the extractor does. */
async function androidModems(): Promise<AndroidModem[]> {
  return Promise.all(MODEM_FIXTURES.map(async ({ family, firmware, devices, archives }) => {
    const configs = await Promise.all(archives.map(async (archive) => {
      const sha = await storeObj(archive, "android.modem-config");
      const n = await modemConfig(archive, sha);
      modemConfigs.set(sha, n.config);
      if (n.base) modemConfigs.set(n.base.sha, n.base);
      for (const [key, list] of n.combos) await putJson(keys.combos(key), list);
      return [n.config.label, sha] as const;
    }));
    return { family, firmware, devices: [...devices], configs: Object.fromEntries(configs) };
  }));
}

const androidReleases: AndroidRelease[] = [];
for (const build of BUILDS) {
  const sources: Record<SourceKey<"android">, AndroidArtifact[]> = {};
  for (const file of ANDROID_FILES) {
    const byBytes = new Map<string, { bytes: Uint8Array; devices: string[] }>();
    for (const device of build.devices) {
      const bytes = file.bytes(build.generation, device);
      const id = sha1Hex(bytes);
      const group = byBytes.get(id) ?? { bytes, devices: [] };
      group.devices.push(device);
      byBytes.set(id, group);
    }
    const ref: SourceRef<"android"> = { platform: "android", kind: "carrier", name: file.name };
    sources[sourceKey(ref)] = await Promise.all([...byBytes.values()].map(async ({ bytes, devices }) => {
      const settings = decodeCarrierSettings(bytes);
      const sha = await storeObj(bytes, "android.carrier-settings");
      profiles.set(sha, androidProfile(settings, ref, sha, list));
      return { sha, version: settings.version ?? "0", size: bytes.length, devices };
    }));
  }
  androidReleases.push({
    platform: "android", id: build.id, version: build.version, patch: build.patch, released: build.released,
    devices: [...build.devices], extractedAt: NOW, sources, carrierList: listSha, modems: build.generation ? await androidModems() : [],
  });
}

for (const [sha, p] of profiles) await putJson(keys.norm(sha), p);
for (const [sha, c] of modemConfigs) await putJson(keys.norm(sha), c);
for (const r of [...appleReleases, ...androidReleases]) await putJson(keys.release(r.platform, r.id), r);
await putJson(keys.otaFiles(), OTA);

const manifest = new Uint8Array(await readFile(join(FIXTURES, "manifest.xml")));
const manifestSha1 = sha1Hex(manifest);
await put(keys.otaManifest(manifestSha1), manifest);
await putJson(keys.otaManifestCurrent(), { sha1: manifestSha1 });

const index = buildIndexes({
  releases: [...appleReleases, ...androidReleases],
  otaFiles: OTA,
  devices: DEVICES,
  labels: DEVICE_LABELS,
  profiles: (sha) => {
    const p = profiles.get(sha);
    return p && indexProfile(p);
  },
  modemConfigs: (sha) => {
    const c = modemConfigs.get(sha);
    return c && indexModemConfig(c);
  },
  manifestSims: manifestSims(parseManifest(manifest)),
  carrierIds: {},
});
// The index as D1 statements, beside the bucket rather than in it: the seed script applies them to the site's local D1.
await writeFile(join(out, INDEX_STATEMENTS), JSON.stringify((await delta(indexRows(index), emptyLive(NOW))).statements));

process.stderr.write(`${profiles.size} profiles, ${index.carriers.length} carriers, ${Object.keys(index.sources).length} sources → ${out}\n`);
