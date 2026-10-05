/** A modem package's decoded summary; an Apple ftab has 'rkosftab' at 0x20, a bbfw is a zip. */

import { basename } from "node:path";
import { unzipSync } from "fflate";

import { latin1 } from "@carrier-explode/binary";
import { basebandSummary, buildMccMnc, ftabSummary, MODEM_SUMMARY_SCHEMA, parseManifest, type MccMncTable, type ModemSummary } from "@carrier-explode/decode-ios";
import { keys } from "@carrier-explode/storage";
import type { R2Client } from "../../../job.ts";
import { storedManifest } from "../../shared/manifest.ts";

/** The only bbfw members the summary reads; the rest (hundreds of MB) stay compressed. */
const BBFW_MEMBERS = new Set(["bbcfg.mbn", "pt.mbn", "Info.plist", "qdsp6sw.mbn"]);

export const summaryKey = (sha: string): string => keys.modemSummary(MODEM_SUMMARY_SCHEMA, sha);

const isFtab = (b: Uint8Array): boolean => latin1(b.subarray(0x20, 0x28)) === "rkosftab";

/** The stored OTA manifest's PLMN table, which maps a bbfw's band-combo tags to bundles; loaded on first call. */
export function carrierTable(r2: R2Client): () => Promise<MccMncTable> {
  let table: Promise<MccMncTable> | undefined;
  return () =>
    (table ??= storedManifest(r2).then((bytes) => {
      const t = buildMccMnc(parseManifest(bytes));
      if (!t.entries.length) throw new Error("the stored OTA manifest has no MobileDeviceCarriersByMccMnc");
      return t;
    }));
}

/** `name` is the path under Firmware/, which the family is read off. */
export async function modemSummary(bytes: Uint8Array, name: string, mccMnc: () => Promise<MccMncTable>): Promise<ModemSummary> {
  if (isFtab(bytes)) return ftabSummary(bytes, { name });
  const listing: Array<{ name: string; size: number }> = [];
  const zip = unzipSync(bytes, {
    filter: (f) => {
      if (!f.name.endsWith("/")) listing.push({ name: f.name, size: f.originalSize });
      return BBFW_MEMBERS.has(basename(f.name));
    },
  });
  const members = Object.fromEntries(Object.entries(zip).map(([n, b]) => [basename(n), b]));
  return basebandSummary(members, { name, listing, mccMnc: await mccMnc() });
}
