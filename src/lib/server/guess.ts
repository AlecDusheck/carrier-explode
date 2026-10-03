/**
 * Turn the visitor's network name into a carrier search.
 *
 * Cloudflare reports the AS organisation ("Verizon Business", "T-Mobile USA,
 * Inc."). Bundle names are terser (Verizon_LTE_US, TMobile_US), so take the
 * longest run of leading words that still matches some bundle, which for most
 * operators is the brand on its own.
 */

import { carrierName, fold } from "#lib/names.ts";

const norm = (s: string) => s.toLowerCase().replace(/&/g, "").replace(/[^a-z0-9 ]+/g, "").trim();
/** What a search for a carrier is matched against: its bundle name and its brand ("China Mobile" for CMCC). */
const names = (c: { name: string; display: string }) => [fold(c.display), fold(carrierName(c.name).brand)];

export function guessCarrierQuery(org: string | undefined, carriers: Array<{ name: string; display: string }>): string | null {
  if (!org) return null;
  const words = norm(org).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const haystack = carriers.flatMap(names);

  for (let n = Math.min(words.length, 3); n >= 1; n--) {
    // "T-Mobile" normalises to "tmobile" in one word; "AT T" style splits need joining.
    const joined = words.slice(0, n).join("");
    // Two letters match half the list by accident.
    if (joined.length < 3) continue;
    if (haystack.some((h) => h.includes(joined))) return joined;
  }
  return null;
}

/**
 * The one bundle a search like that most likely means: of the bundles it matches, one from the
 * visitor's country, then the plainest name (ATT_US over ATT_FirstNet_US).
 */
export function guessCarrierBundle(query: string, carriers: Array<{ name: string; display: string; cc?: string }>, cc: string | null): string | null {
  const hits = carriers.filter((c) => names(c).some((n) => n.includes(query)));
  hits.sort((a, b) => Number(b.cc === cc) - Number(a.cc === cc) || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return hits[0]?.name ?? null;
}
