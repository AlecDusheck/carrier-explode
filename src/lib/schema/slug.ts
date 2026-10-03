/**
 * Carrier ids (Carrier.slug): the key of index/carriers/<id>.json, never shown
 * in a URL (pages are per source, at sourcePath). Readable and stable: the
 * name of the carrier's primary member (./identity.ts primary: an Apple
 * bundle with the most SIM rules, else the largest Android canonical), or
 * `<platform>-<name>` when another carrier already holds that name. A carrier
 * keeps the id its members had in the previous index while that id is still
 * one of its own names, so documents do not move when a member gains matchers.
 */

import type { Platform } from "./types.ts";

export interface SlugMember {
  readonly key: string;
  readonly platform: Platform;
  readonly name: string;
}

/** Ids a carrier may hold: each member's name, and its platform-qualified form. */
const ownIds = (members: readonly SlugMember[]): Set<string> =>
  new Set(members.flatMap((m) => [m.name, `${m.platform}-${m.name}`]));

/**
 * One id per carrier, in input order. `carriers` lists each carrier's members,
 * primary first. Larger carriers choose first, so when a carrier splits, its
 * larger part keeps the old id.
 */
export function assignSlugs(carriers: ReadonlyArray<readonly SlugMember[]>, previous: Readonly<Record<string, string>> = {}): string[] {
  const taken = new Set<string>();
  const out = carriers.map(() => "");
  const order = carriers.map((ms, i) => ({ ms, i })).sort((a, b) => b.ms.length - a.ms.length || a.i - b.i);
  for (const { ms, i } of order) {
    const own = ownIds(ms);
    const votes = new Map<string, number>();
    for (const m of ms) {
      const id = previous[m.key];
      if (id !== undefined && own.has(id)) votes.set(id, (votes.get(id) ?? 0) + 1);
    }
    const kept = [...votes].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([id]) => id).find((id) => !taken.has(id));
    const head = ms[0];
    const candidates = [kept, head?.name, head ? `${head.platform}-${head.name}` : undefined].flatMap((c) => (c === undefined ? [] : [c]));
    let id = candidates.find((c) => !taken.has(c)) ?? head?.name ?? "carrier";
    // Two carriers whose primaries share a name on one platform cannot happen (names are unique per platform); the counter only guards it.
    for (let n = 2; taken.has(id); n++) id = `${head?.platform ?? "carrier"}-${head?.name ?? ""}-${n}`;
    taken.add(id);
    out[i] = id;
  }
  return out;
}
