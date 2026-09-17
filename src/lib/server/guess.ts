/**
 * Turn the visitor's network name into a carrier search.
 *
 * Cloudflare reports the AS organisation ("Verizon Business", "T-Mobile USA,
 * Inc."). Bundle names are terser (Verizon_LTE_US, TMobile_US), so take the
 * longest run of leading words that still matches some bundle, which for most
 * operators is the brand on its own.
 */

const norm = (s: string) => s.toLowerCase().replace(/&/g, "").replace(/[^a-z0-9 ]+/g, "").trim();

export function guessCarrierQuery(org: string | undefined, carriers: Array<{ name: string; display: string }>): string | null {
  if (!org) return null;
  const words = norm(org).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const haystack = carriers.map((c) => norm(c.display).replace(/ /g, ""));

  for (let n = Math.min(words.length, 3); n >= 1; n--) {
    // "T-Mobile" normalises to "tmobile" in one word; "AT T" style splits need joining.
    const joined = words.slice(0, n).join("");
    // Two letters match half the list by accident.
    if (joined.length < 3) continue;
    if (haystack.some((h) => h.includes(joined))) return joined;
  }
  return null;
}
