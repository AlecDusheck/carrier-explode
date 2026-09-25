/**
 * Links between carrier and country bundles.
 *
 * A carrier names its country bundle in HomeBundleIdentifier
 * ("com.apple.UnitedStates"); that is exact. Older bundles lack the key, and
 * going the other way would mean opening every carrier, so both fall back to
 * the ISO codes a country bundle lists against the country suffix in a
 * carrier's name.
 */

/** Country bundle name -> its decoded carrier.plist (system/<build>/countries.json). */
export type CountryPlists = Record<string, Record<string, unknown>>;

export function isoIndex(plists: CountryPlists): Map<string, string> {
  const out = new Map<string, string>();
  for (const [country, p] of Object.entries(plists)) {
    if (!Array.isArray(p.ISOAlpha2CountryCode)) continue;
    for (const iso of p.ISOAlpha2CountryCode) {
      // A territory can appear under its parent too (cx under Australia); first listed wins.
      if (typeof iso === "string" && !out.has(iso.toLowerCase())) out.set(iso.toLowerCase(), country);
    }
  }
  return out;
}

export function homeCountry(
  carrierPlist: Record<string, unknown> | undefined,
  cc: string | undefined,
  countries: Set<string>,
  byIso: Map<string, string>,
): string | null {
  const home = carrierPlist?.HomeBundleIdentifier;
  if (typeof home === "string") {
    const name = home.replace(/^com\.apple\./, "");
    if (countries.has(name)) return name;
  }
  return (cc && byIso.get(cc)) || null;
}

export function carriersOf(country: string, plists: CountryPlists, carriers: Array<{ name: string; cc?: string }>): string[] {
  const iso = plists[country]?.ISOAlpha2CountryCode;
  if (!Array.isArray(iso)) return [];
  const codes = new Set(iso.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()));
  return carriers.filter((c) => c.cc && codes.has(c.cc)).map((c) => c.name);
}
