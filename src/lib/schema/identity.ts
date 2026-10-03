/** Links sources into carriers by exact shared SIM rules; the rules and their reasons: docs/concepts.md#sim-linking. */

import { LINKS, type Links } from "./links.ts";
import { decoderFamily, matcherKey, type CarrierLink, type SimMatcher, type SourceRef } from "./types.ts";

export interface LinkMember {
  /** sourceKey. */
  readonly key: string;
  readonly source: SourceRef;
  readonly sims: readonly SimMatcher[];
  readonly display: string;
  readonly iso: readonly string[];
}



/** A carrier before it has an id. */
export interface LinkedGroup {
  readonly name: string;
  readonly iso: string | undefined;
  readonly members: readonly LinkMember[];
  readonly links: readonly CarrierLink[];
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}\n${b}` : `${b}\n${a}`);

/** Union-find over source keys. */
class Groups {
  readonly #parent = new Map<string, string>();
  find(k: string): string {
    let root = k;
    for (let up = this.#parent.get(root); up !== undefined && up !== root; up = this.#parent.get(root)) root = up;
    this.#parent.set(k, root);
    return root;
  }
  union(a: string, b: string): void {
    const [ra, rb] = [this.find(a), this.find(b)];
    if (ra === rb) return;
    // The smaller key becomes the root, so grouping does not depend on edge order.
    const [child, root] = ra < rb ? [rb, ra] : [ra, rb];
    this.#parent.set(child, root);
  }
}

/** Shared keys between every pair of linkable sources read by different decoder families (Apple vs Android). */
function sharedKeys(members: readonly LinkMember[]): Map<string, Map<string, string[]>> {
  const owners = new Map<string, LinkMember[]>();
  for (const m of members) for (const k of new Set(m.sims.map(matcherKey))) {
    const list = owners.get(k);
    if (list) list.push(m);
    else owners.set(k, [m]);
  }
  const shared = new Map<string, Map<string, string[]>>();
  const note = (from: LinkMember, to: LinkMember, k: string): void => {
    const row = shared.get(from.key) ?? new Map<string, string[]>();
    shared.set(from.key, row);
    row.set(to.key, [...(row.get(to.key) ?? []), k]);
  };
  for (const [k, list] of owners) {
    const apple = list.filter((m) => decoderFamily(m.source.platform) === "apple");
    const android = list.filter((m) => decoderFamily(m.source.platform) === "android");
    for (const a of apple) {
      for (const b of android) {
        note(a, b, k);
        note(b, a, k);
      }
    }
  }
  return shared;
}

/** The counterparts a source shares the most keys with (several on a tie). */
function best(row: ReadonlyMap<string, readonly string[]> | undefined): Set<string> {
  if (!row) return new Set();
  const top = Math.max(0, ...[...row.values()].map((k) => k.length));
  return new Set([...row].filter(([, k]) => k.length === top && top > 0).map(([key]) => key));
}

function simEdges(members: readonly LinkMember[], splits: ReadonlySet<string>): Array<{ a: string; b: string; shared: string[] }> {
  const shared = sharedKeys(members);
  const edges = new Map<string, { a: string; b: string; shared: string[] }>();
  const add = (a: string, b: string): void => {
    const keys = shared.get(a)?.get(b) ?? [];
    if (!splits.has(pairKey(a, b))) edges.set(pairKey(a, b), { a, b, shared: [...keys].sort() });
  };
  const bests = new Map(members.map((m) => [m.key, best(shared.get(m.key))]));
  for (const m of members) {
    const mine = bests.get(m.key) ?? new Set<string>();
    const mutual = [...mine].filter((t) => bests.get(t)?.has(m.key));
    if (mutual.length) { for (const t of mutual) add(m.key, t); continue; }
    const own = new Set(m.sims.map(matcherKey)).size;
    for (const t of mine) {
      const n = shared.get(m.key)?.get(t)?.length ?? 0;
      if (n * 2 >= own) add(m.key, t);
    }
  }
  return [...edges.values()];
}

/** The member a carrier is named after: an Apple bundle (they carry brand names) with the most SIM rules, else the largest Android canonical. */
export function primary(members: readonly LinkMember[]): LinkMember | undefined {
  const rank = (m: LinkMember): number => (decoderFamily(m.source.platform) === "apple" ? 1e6 : 0) + m.sims.length;
  return [...members].sort((x, y) => rank(y) - rank(x) || x.key.localeCompare(y.key))[0];
}

function mostCommonIso(members: readonly LinkMember[]): string | undefined {
  const counts = new Map<string, number>();
  for (const m of members) for (const iso of m.iso) counts.set(iso, (counts.get(iso) ?? 0) + 1);
  return [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0];
}

/** Carriers from sources; country bundles are not carriers and are left out. */
export function linkSources(members: readonly LinkMember[], links: Links = LINKS): LinkedGroup[] {
  const linkable = members.filter((m) => m.source.kind === "carrier");
  const known = new Set(members.map((m) => m.key));
  const splits = new Set(links.split.map(({ a, b }) => pairKey(a, b)));
  const groups = new Groups();
  const simShared = new Map<string, Set<string>>();
  const manual = new Set<string>();
  for (const e of simEdges(linkable, splits)) {
    groups.union(e.a, e.b);
    for (const k of [e.a, e.b]) simShared.set(k, new Set([...(simShared.get(k) ?? []), ...e.shared]));
  }
  // Apple names a carrier's iPhone, iPad and Watch bundles alike (ATT_US): one bundle name is one carrier.
  const appleByName = new Map<string, string>();
  for (const m of linkable) {
    if (decoderFamily(m.source.platform) !== "apple") continue;
    const first = appleByName.get(m.source.name);
    if (first === undefined) appleByName.set(m.source.name, m.key);
    else groups.union(first, m.key);
  }
  for (const { a, b } of links.link) {
    if (!known.has(a) || !known.has(b)) continue;
    groups.union(a, b);
    manual.add(a);
    manual.add(b);
  }

  const byRoot = new Map<string, LinkMember[]>();
  for (const m of members.filter((x) => x.source.kind !== "country")) {
    const root = groups.find(m.key);
    byRoot.set(root, [...(byRoot.get(root) ?? []), m]);
  }
  /** A member alone needs no reason. */
  const reason = (m: LinkMember): CarrierLink[] => {
    const keys = simShared.get(m.key);
    if (keys?.size) return [{ source: m.key, reason: "sims", shared: [...keys].sort() }];
    return manual.has(m.key) ? [{ source: m.key, reason: "manual" }] : [];
  };
  return [...byRoot.values()].map((list): LinkedGroup => {
    const sorted = [...list].sort((x, y) => x.key.localeCompare(y.key));
    const head = primary(sorted);
    const manualName = sorted.map((m) => links.names[m.key]).find((n) => n !== undefined);
    return {
      name: manualName ?? head?.display ?? sorted[0]?.source.name ?? "",
      iso: head?.iso[0] ?? mostCommonIso(sorted),
      members: sorted,
      links: sorted.length > 1 ? sorted.flatMap(reason) : [],
    };
  });
}
