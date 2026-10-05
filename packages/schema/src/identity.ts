/** Links sources into carriers by exact shared SIM rules (matcherKey); manual links and splits are ./links.ts, each with its reason. */

import { LINKS, type Links } from "./links.ts";
import { APPLE_PLATFORMS, decoderFamily, matcherKey, PLATFORMS, sourceKey, sourceOf, type CarrierLink, type Platform, type SimMatcher, type SourceKey, type SourceRef } from "./types.ts";

export interface LinkMember {
  readonly key: SourceKey;
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

/** Union-find over source keys that never puts a pair kept apart into one group. */
class Groups {
  readonly #parent = new Map<string, string>();
  readonly #apart: ReadonlyArray<readonly [string, string]>;
  constructor(apart: ReadonlyArray<readonly [string, string]>) {
    this.#apart = apart;
  }
  find(k: string): string {
    let root = k;
    for (let up = this.#parent.get(root); up !== undefined && up !== root; up = this.#parent.get(root)) root = up;
    this.#parent.set(k, root);
    return root;
  }
  /** Whether a and b are in one group afterwards. */
  join(a: string, b: string): boolean {
    const [ra, rb] = [this.find(a), this.find(b)];
    if (ra === rb) return true;
    const bridges = ([x, y]: readonly [string, string]): boolean => {
      const [rx, ry] = [this.find(x), this.find(y)];
      return (rx === ra && ry === rb) || (rx === rb && ry === ra);
    };
    if (this.#apart.some(bridges)) return false;
    const [child, root] = ra < rb ? [rb, ra] : [ra, rb];
    this.#parent.set(child, root);
    return true;
  }
}

/** Manual links first, then by shared keys: a split drops the weakest bridge. */
const strength = (e: CarrierLink): number => (e.kind === "manual" ? Number.MAX_SAFE_INTEGER : e.shared.length);

/** Keys shared between every pair of sources on different platforms: one platform never links to itself. */
function sharedKeys(members: readonly LinkMember[]): Map<SourceKey, Map<SourceKey, string[]>> {
  const owners = new Map<string, LinkMember[]>();
  for (const m of members) {
    for (const k of new Set(m.sims.map(matcherKey))) owners.set(k, [...(owners.get(k) ?? []), m]);
  }
  const shared = new Map<SourceKey, Map<SourceKey, string[]>>();
  for (const [k, list] of owners) {
    for (const a of list) {
      for (const b of list) {
        if (a.source.platform === b.source.platform) continue;
        const row = shared.get(a.key) ?? new Map<SourceKey, string[]>();
        shared.set(a.key, row);
        row.set(b.key, [...(row.get(b.key) ?? []), k]);
      }
    }
  }
  return shared;
}

const platformOf = (k: SourceKey): Platform => sourceOf(k).platform;

/** On each other platform, the sources this one shares the most keys with (several on a tie). */
function best(row: ReadonlyMap<SourceKey, readonly string[]> | undefined): Set<SourceKey> {
  const top = new Map<Platform, number>();
  for (const [k, keys] of row ?? []) top.set(platformOf(k), Math.max(top.get(platformOf(k)) ?? 0, keys.length));
  return new Set([...(row ?? [])].filter(([k, keys]) => keys.length > 0 && keys.length === top.get(platformOf(k))).map(([k]) => k));
}

/** Per other platform: mutual best matches, else one-sided best matches covering at least half of the chooser's rules. */
function simEdges(members: readonly LinkMember[]): CarrierLink[] {
  const shared = sharedKeys(members);
  const bests = new Map(members.map((m) => [m.key, best(shared.get(m.key))]));
  const edges = new Map<string, CarrierLink>();
  const add = (a: SourceKey, b: SourceKey): void => {
    if (edges.has(pairKey(a, b))) return;
    edges.set(pairKey(a, b), { kind: "sims", between: [a, b], shared: [...(shared.get(a)?.get(b) ?? [])].sort() });
  };
  const own = (m: LinkMember): number => new Set(m.sims.map(matcherKey)).size;
  for (const m of members) {
    const byPlatform = new Map<Platform, SourceKey[]>();
    for (const t of bests.get(m.key) ?? []) byPlatform.set(platformOf(t), [...(byPlatform.get(platformOf(t)) ?? []), t]);
    for (const candidates of byPlatform.values()) {
      const mutual = candidates.filter((t) => bests.get(t)?.has(m.key));
      const chosen = mutual.length ? mutual : candidates.filter((t) => (shared.get(m.key)?.get(t)?.length ?? 0) * 2 >= own(m));
      for (const t of chosen) add(m.key, t);
    }
  }
  return [...edges.values()];
}

/** The member a carrier is named after: by platform in PLATFORMS order (Apple's names are brands), then the most SIM rules. */
export function primary(members: readonly LinkMember[]): LinkMember | undefined {
  const rank = (m: LinkMember): number => PLATFORMS.indexOf(m.source.platform);
  return [...members].sort((x, y) => rank(x) - rank(y) || y.sims.length - x.sims.length || x.key.localeCompare(y.key))[0];
}

function mostCommonIso(members: readonly LinkMember[]): string | undefined {
  const counts = new Map<string, number>();
  for (const m of members) for (const iso of m.iso) counts.set(iso, (counts.get(iso) ?? 0) + 1);
  return [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0];
}

/** An Apple bundle's iPhone, iPad and Watch files: one carrier's, by name. */
function namesakes(k: SourceKey): SourceKey[] {
  const s = sourceOf(k);
  if (decoderFamily(s.platform) === "android") return [k];
  return APPLE_PLATFORMS.map((platform) => sourceKey({ ...s, platform }));
}

/** Carriers from sources; country bundles are not carriers and are left out. */
export function linkSources(members: readonly LinkMember[], links: Links = LINKS): LinkedGroup[] {
  const linkable = members.filter((m) => m.source.kind === "carrier");
  const known = new Set<SourceKey>(members.map((m) => m.key));
  const manual = links.link.flatMap(({ a, b }): CarrierLink[] => (known.has(a) && known.has(b) ? [{ kind: "manual", between: [a, b] }] : []));
  const edges = [...simEdges(linkable), ...manual]
    .sort((x, y) => strength(y) - strength(x) || pairKey(...x.between).localeCompare(pairKey(...y.between)));
  const groups = new Groups(links.split.flatMap(({ a, b }) => namesakes(a).flatMap((x) => namesakes(b).map((y): readonly [string, string] => [x, y]))));
  const kept = edges.filter((e) => groups.join(...e.between));

  const byRoot = new Map<string, LinkMember[]>();
  for (const m of members) {
    if (m.source.kind === "country") continue;
    const root = groups.find(m.key);
    byRoot.set(root, [...(byRoot.get(root) ?? []), m]);
  }
  return [...byRoot].map(([root, list]): LinkedGroup => {
    const sorted = [...list].sort((x, y) => x.key.localeCompare(y.key));
    const head = primary(sorted);
    const named = sorted.map((m) => links.names[m.key]).find((n) => n !== undefined);
    return {
      name: named ?? head?.display ?? sorted[0]?.source.name ?? "",
      iso: head?.iso[0] ?? mostCommonIso(sorted),
      members: sorted,
      links: kept.filter((e) => groups.find(e.between[0]) === root),
    };
  });
}
