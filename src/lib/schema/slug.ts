/**
 * URL keys. The site keeps its v1 URLs and adds Android inside them, so:
 *
 * Carrier slugs are the primary iOS bundle name, exactly as v1 used it
 * (`TMobile_US`). With several iOS bundles, the primary is the one the most
 * SIM matchers point to, tie-broken by name. A carrier with no iOS bundle uses
 * its Android canonical name (the one with the most matchers, same tie-break),
 * prefixed `android-` if that name is also an iOS bundle name. Country
 * documents are keyed by the iOS country bundle name (`UnitedStates`).
 *
 * Published slugs are links people keep: a carrier whose members had a slug in
 * the previous index keeps it while that slug is still one of its own names,
 * even if another member now has more matchers.
 *
 * Version slugs: `ios-<version>`, `ota-<build>[-<model>]`, and
 * `android-<build lower-cased>[-<codename>]` (./timeline.ts); VERSION_SLUG is
 * the one grammar the site's param matcher uses.
 */

import type { Platform } from "./types.ts";

/** Every timeline entry slug matches this; tab names and other path words never do. */
export const VERSION_SLUG = /^(?:ios-\d[\w.-]*|ota-[\w.,-]+|android-[a-z0-9][a-z0-9._-]*)$/;

export const isVersionSlug = (s: string): boolean => VERSION_SLUG.test(s);

export interface SlugMember {
  readonly key: string;
  readonly platform: Platform;
  readonly name: string;
  readonly matchers: number;
}

const byWeight = (a: SlugMember, b: SlugMember): number => b.matchers - a.matchers || a.name.localeCompare(b.name);

/** The slug the rule gives a carrier, before history is considered. */
export function ruleSlug(members: readonly SlugMember[], iosNames: ReadonlySet<string>): string {
  const ios = members.filter((m) => m.platform === "ios").sort(byWeight)[0];
  if (ios) return ios.name;
  const android = [...members].sort(byWeight)[0];
  if (!android) return "";
  return iosNames.has(android.name) ? `android-${android.name}` : android.name;
}

/** Every slug a carrier could rightfully hold: its iOS bundle names and its Android names (prefixed where they clash). */
function ownNames(members: readonly SlugMember[], iosNames: ReadonlySet<string>): Set<string> {
  return new Set(members.map((m) => (m.platform === "android" && iosNames.has(m.name) ? `android-${m.name}` : m.name)));
}

/**
 * One slug per carrier (each a list of members), in input order. Carriers with
 * the most members choose first, so when a carrier splits, its larger part
 * keeps the published slug. Names are unique per platform and Android names
 * that clash with iOS ones are prefixed, so the numeric suffix is a guard for
 * kept slugs colliding, not a path real data takes.
 */
export function assignSlugs(carriers: ReadonlyArray<readonly SlugMember[]>, previous: Readonly<Record<string, string>> = {}): string[] {
  const iosNames = new Set(carriers.flatMap((ms) => ms.filter((m) => m.platform === "ios").map((m) => m.name)));
  const taken = new Set<string>();
  const out = carriers.map(() => "");
  const order = carriers.map((ms, i) => ({ ms, i })).sort((a, b) => b.ms.length - a.ms.length || a.i - b.i);
  for (const { ms, i } of order) {
    const own = ownNames(ms, iosNames);
    const votes = new Map<string, number>();
    for (const m of ms) {
      const s = previous[m.key];
      if (s !== undefined && own.has(s)) votes.set(s, (votes.get(s) ?? 0) + 1);
    }
    const kept = [...votes].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([s]) => s).find((s) => !taken.has(s));
    const base = kept ?? ruleSlug(ms, iosNames);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    out[i] = slug;
  }
  return out;
}
