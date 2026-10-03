/**
 * A modem package's decoded summary, as the site's baseband pages read it: a
 * port of scripts/baseband.ts onto the iOS decoder's basebandSummary and
 * ftabSummary. The kind is read off the bytes: a .bbfw is a zip, an Apple
 * ftab has 'rkos' 'ftab' at 0x20.
 */

import { basename } from "node:path";
import { unzipSync } from "fflate";

import { basebandSummary, ftabSummary, latin1, type ModemSummary } from "../../../../../../src/lib/decode/index.ts";

/** The only bbfw members the summary reads; the rest (hundreds of MB) stay compressed. */
const BBFW_MEMBERS = new Set(["bbcfg.mbn", "pt.mbn", "Info.plist", "qdsp6sw.mbn"]);

const isFtab = (b: Uint8Array): boolean => latin1(b.subarray(0x20, 0x28)) === "rkosftab";

/**
 * `name` is the package's path under Firmware/ (Mav25-2.10.01.Release.bbfw,
 * c4000v59/Release/patched/ftab.bin); the family is read off it. `mccMnc` is
 * the OTA manifest's MobileDeviceCarriersByMccMnc, which maps band-combo
 * carrier tags to bundles; without it that map is left out.
 */
export function modemSummary(bytes: Uint8Array, name: string, mccMnc?: unknown): ModemSummary {
  if (isFtab(bytes)) return ftabSummary(bytes, { name });
  const listing: Array<{ name: string; size: number }> = [];
  const zip = unzipSync(bytes, {
    filter: (f) => {
      if (!f.name.endsWith("/")) listing.push({ name: f.name, size: f.originalSize });
      return BBFW_MEMBERS.has(basename(f.name));
    },
  });
  const members = Object.fromEntries(Object.entries(zip).map(([n, b]) => [basename(n), b]));
  return basebandSummary(members, { name, listing, ...(mccMnc === undefined ? {} : { mccMnc }) });
}
