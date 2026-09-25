/**
 * Summarises a modem package into the baseband/<id>.json the site reads. Run
 * with vite-node (for `$lib`). The kind is read off the file: a .bbfw is a zip,
 * an Apple ftab has 'rkos' 'ftab' at 0x20.
 *
 *   baseband.ts <package> --name NAME --out summary.json [--manifest manifest.plist] [--no-modem]
 *
 * NAME is the package name as the index records it (Mav25-2.10.01.Release.bbfw,
 * c4000v59/Release/patched/ftab.bin); the family is read off it. bbfw only:
 * --manifest is the OTA carrier manifest, used to map band-combo carrier tags to
 * bundles (without it the live one is fetched); --no-modem skips qdsp6sw.mbn.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { unzipSync } from "fflate";

import { basebandSummary, ftabSummary, type ModemSummary } from "$lib/decode";
import { MANIFEST_URL, parseManifest } from "$lib/server/manifest";

const { positionals, values: arg } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" }, out: { type: "string" }, manifest: { type: "string" }, "no-modem": { type: "boolean" },
  },
});

const src = positionals[0];
if (!src || !arg.out) {
  console.error("usage: baseband.ts <package> --name NAME --out summary.json [--manifest manifest.plist] [--no-modem]");
  process.exit(2);
}
const name = arg.name ?? basename(src);

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

async function bbfw(bytes: Uint8Array): Promise<ModemSummary> {
  const want = new Set(["bbcfg.mbn", "pt.mbn", "Info.plist", ...(arg["no-modem"] ? [] : ["qdsp6sw.mbn"])]);
  const listing: Array<{ name: string; size: number }> = [];
  // Only the members we read get inflated.
  const zip = unzipSync(bytes, {
    filter: (f) => {
      if (!f.name.endsWith("/")) listing.push({ name: f.name, size: f.originalSize });
      return want.has(basename(f.name));
    },
  });
  const members = Object.fromEntries(Object.entries(zip).map(([n, b]) => [basename(n), b]));
  const m = await manifestBytes();
  const mccMnc = m ? parseManifest(m).MobileDeviceCarriersByMccMnc : undefined;
  const s = basebandSummary(members, { name, listing, mccMnc });
  console.error(
    `${name} ${s.package.version ?? "?"}: ${s.files.length} files, ${s.nv.length} NV blobs, ` +
      `${s.bandCombos.length} band-combo sets, ${s.modemConfigs?.length ?? 0} modem configs`,
  );
  return s;
}

function ftab(bytes: Uint8Array): ModemSummary {
  const s = ftabSummary(bytes, { name });
  console.error(`${name} ${s.package.version ?? "?"} (${s.package.chip ?? "?"}, ${s.package.date ?? "?"}): ${s.entries.length} entries`);
  return s;
}

const bytes = new Uint8Array(readFileSync(src));
const isFtab = new TextDecoder("latin1").decode(bytes.subarray(0x20, 0x28)) === "rkosftab";
const summary = isFtab ? ftab(bytes) : await bbfw(bytes);
if (!summary.package.family) {
  console.error(`${name}: no modem family in the name`);
  process.exit(1);
}
const json = JSON.stringify(summary);
writeFileSync(arg.out, json);
console.error(`${summary.package.family} (${summary.kind}): ${json.length} bytes`);
