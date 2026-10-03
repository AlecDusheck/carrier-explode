/**
 * Turn the visitor's network name into a carrier search.
 *
 * Cloudflare reports the AS organisation ("Verizon Business", "T-Mobile USA,
 * Inc."). Carrier names are terser, so take the longest run of leading words
 * that still matches some carrier, which for most operators is the brand on
 * its own.
 */

import { fold } from "#lib/names.ts";

/** What the guesses read of a carrier. */
export interface Guessable {
  readonly slug: string;
  readonly name: string;
  readonly iso?: string | undefined;
}

const norm = (s: string): string => s.toLowerCase().replace(/&/g, "").replace(/[^a-z0-9 ]+/g, "").trim();
/** What a search for a carrier is matched against: its name and its slug ("att-us" for AT&T). */
const names = (c: Guessable): string[] => [fold(c.name), fold(c.slug)];

export function guessCarrierQuery(org: string | undefined, carriers: readonly Guessable[]): string | null {
  if (!org) return null;
  const words = norm(org).split(/\s+/).filter(Boolean);
  const haystack = carriers.flatMap(names);
  for (let n = Math.min(words.length, 3); n >= 1; n--) {
    // "T-Mobile" normalises to "tmobile" in one word; "AT T" style splits need joining.
    const joined = words.slice(0, n).join("");
    // Two letters match half the list by accident.
    if (joined.length >= 3 && haystack.some((h) => h.includes(joined))) return joined;
  }
  return null;
}

/**
 * The one carrier a search like that most likely means: of the carriers it matches, one from the
 * visitor's country, then the plainest name (AT&T over AT&T FirstNet).
 */
export function guessCarrierSlug(query: string, carriers: readonly Guessable[], cc: string | null): string | null {
  const hits = carriers.filter((c) => names(c).some((n) => n.includes(query)));
  hits.sort((a, b) => Number(b.iso === cc) - Number(a.iso === cc) || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return hits[0]?.slug ?? null;
}
