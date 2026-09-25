/**
 * Summarises a baseband package (Firmware/Mav*.bbfw from an IPSW) into the
 * baseband.json the site reads (system/<build>/baseband.json). Run with vite-node (for `$lib`).
 *
 *   baseband.ts <bbfw> --out baseband.json [--manifest manifest.plist] [--no-modem]
 *
 * --manifest is the OTA carrier manifest, used to map band-combo carrier tags
 * to bundles; without it the live one is fetched. --no-modem skips
 * qdsp6sw.mbn (its built-in configs), which saves inflating ~127 MB.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { unzipSync } from "fflate";

import { basebandSummary } from "$lib/decode";
import { MANIFEST_URL, parseManifest } from "$lib/server/manifest";

const { positionals, values: arg } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" }, manifest: { type: "string" }, "no-modem": { type: "boolean" } },
});

const src = positionals[0];
if (!src || !arg.out) {
  console.error("usage: baseband.ts <bbfw> --out baseband.json [--manifest manifest.plist] [--no-modem]");
  process.exit(2);
}

async function manifestBytes(): Promise<Uint8Array | undefined> {
  if (arg.manifest) return new Uint8Array(readFileSync(arg.manifest));
  try {
    const res = await fetch(MANIFEST_URL, { headers: { "user-agent": "carrier-explode/1.0" } });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    console.error(`manifest: HTTP ${res.status}, carrier map skipped`);
  } catch (e) {
    console.error(`manifest: ${(e as Error).message}, carrier map skipped`);
  }
  return undefined;
}

const want = new Set(["bbcfg.mbn", "pt.mbn", "Info.plist", ...(arg["no-modem"] ? [] : ["qdsp6sw.mbn"])]);
const listing: Array<{ name: string; size: number }> = [];
// Only the members we read get inflated.
const zip = unzipSync(new Uint8Array(readFileSync(src)), {
  filter: (f) => {
    if (!f.name.endsWith("/")) listing.push({ name: f.name, size: f.originalSize });
    return want.has(basename(f.name));
  },
});
const members = Object.fromEntries(Object.entries(zip).map(([n, b]) => [basename(n), b]));

const m = await manifestBytes();
const mccMnc = m ? parseManifest(m).MobileDeviceCarriersByMccMnc : undefined;
const summary = basebandSummary(members, { name: basename(src), listing, mccMnc });
const json = JSON.stringify(summary);
writeFileSync(arg.out, json);
console.error(
  `${basename(src)} ${summary.package.version ?? "?"}: ${summary.files.length} files, ${summary.nv.length} NV blobs, ` +
    `${summary.bandCombos.length} band-combo sets, ${summary.modemConfigs?.length ?? 0} modem configs, ${json.length} bytes`,
);
