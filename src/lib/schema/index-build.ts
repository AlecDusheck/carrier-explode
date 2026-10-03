/**
 * Everything under index/ in one pure function: per-source timelines,
 * carriers (sources linked across platforms), their documents, countries,
 * release summaries and the source -> slug map. The extractor's `index` job
 * only gathers the inputs and writes the outputs; the site only reads them.
 *
 * A source's identity comes from its head profile (the copy most phones run,
 * ./timeline.ts headIndex) plus Apple's manifest routes for iOS. A source whose
 * head is an iOS OTA file not archived yet still has a name and its manifest
 * routes, so it links and gets a page before its bytes are stored.
 */

import { carrierName, countryDisplay, countryName, splitName } from "#lib/names.ts";
import type { CarrierSummary, CountrySummary, OtaRef, ReleaseSummary } from "#lib/storage/keys.ts";
import { conceptById } from "./concepts.ts";
import { linkSources, type LinkMember, type LinkedGroup } from "./identity.ts";
import { isoForCountryName, isoForMcc } from "./mcc.ts";
import { assignSlugs } from "./slug.ts";
import { compareReleases, deviceGroups, headIndex, sourceTimeline } from "./timeline.ts";
import {
  matcherKey, parseSourceKey,
  type Carrier, type CarrierDoc, type ConceptValue, type DeviceStates, type FeatureState, type Profile,
  type Release, type SimMatcher, type SourceRef, type TimelineEntry,
} from "./types.ts";

export interface IndexInput {
  readonly releases: readonly Release[];
  readonly otaRefs: readonly OtaRef[];
  readonly profiles: (sha: string) => Profile | undefined;
  readonly previous?: { readonly sources: Readonly<Record<string, string>> };
  /** iOS SIM routes from Apple's manifest, per sourceKey (`manifestSims` in ./ios). */
  readonly iosManifestSims?: Readonly<Record<string, readonly SimMatcher[]>>;
}

export interface IndexOutput {
  readonly releases: ReleaseSummary[];
  readonly carriers: CarrierSummary[];
  readonly docs: CarrierDoc[];
  readonly countries: CountrySummary[];
  readonly sources: Record<string, string>;
}

interface SourceInfo {
  readonly key: string;
  readonly ref: SourceRef;
  readonly timeline: TimelineEntry[];
  readonly updated: string | undefined;
  /** The newest profile we hold at or below the head. */
  readonly profile: Profile | undefined;
}

/** The first profile we hold, starting at the head and going back. */
function headProfile(timeline: readonly TimelineEntry[], profiles: IndexInput["profiles"]): Profile | undefined {
  const head = headIndex(timeline);
  for (const e of [...timeline.slice(head), ...timeline.slice(0, head)]) {
    const p = e.sha === undefined ? undefined : profiles(e.sha);
    if (p) return p;
  }
  return undefined;
}

function sources(input: IndexInput): SourceInfo[] {
  const keys = new Set<string>([...input.releases.flatMap((r) => Object.keys(r.sources)), ...input.otaRefs.map((r) => r.source)]);
  return [...keys].sort().flatMap((key): SourceInfo[] => {
    const ref = parseSourceKey(key);
    if (!ref) return [];
    const { entries, updated } = sourceTimeline(key, ref.platform, input.releases, input.otaRefs);
    return [{ key, ref, timeline: entries, updated, profile: headProfile(entries, input.profiles) }];
  });
}

/** Name and ISO from the source name alone, for sources with no stored profile yet. */
function fallbackIdentity(ref: SourceRef): { display: string; iso: string[] } {
  if (ref.platform === "ios") {
    if (ref.kind === "country") {
      const iso = isoForCountryName(ref.name);
      return { display: countryDisplay(ref.name), iso: iso ? [iso] : [] };
    }
    const cc = splitName(ref.name).cc;
    return { display: carrierName(ref.name).brand, iso: cc ? [cc] : [] };
  }
  const cc = /_([a-z]{2})$/.exec(ref.name)?.[1];
  const iso = cc !== undefined && countryName(cc) !== undefined ? cc : isoForMcc(ref.name);
  return { display: ref.name, iso: iso ? [iso] : [] };
}

function member(s: SourceInfo, manifest: IndexInput["iosManifestSims"]): LinkMember {
  const fallback = fallbackIdentity(s.ref);
  const sims = new Map<string, SimMatcher>();
  for (const m of [...(s.profile?.identity.sims ?? []), ...(manifest?.[s.key] ?? [])]) sims.set(matcherKey(m), m);
  return {
    key: s.key,
    source: s.ref,
    sims: [...sims.values()],
    display: s.profile?.identity.display ?? fallback.display,
    iso: s.profile?.identity.iso.length ? s.profile.identity.iso : fallback.iso,
  };
}

/* ------------------------------------------------------------------ states */

function statesOf(concepts: Readonly<Record<string, ConceptValue>>): Record<string, FeatureState> {
  const out: Record<string, FeatureState> = {};
  for (const [id, v] of Object.entries(concepts)) {
    if (conceptById(id)?.type === "state" && v.state !== undefined) out[id] = v.state;
  }
  return out;
}

/**
 * Feature states per device group. Android: one group per file the newest
 * build ships for this source. iOS: the head profile (the newest phone's
 * settings) for every phone, then each per-phone variant on top of it.
 */
function deviceStates(s: SourceInfo, profiles: IndexInput["profiles"]): DeviceStates[] {
  const groups = deviceGroups(s.timeline);
  if (groups.length) {
    return groups.flatMap((g) => {
      const e = s.timeline[g.index];
      const p = e?.sha === undefined ? undefined : profiles(e.sha);
      return e && p ? [{ devices: [...g.devices], slug: e.slug, states: statesOf(p.concepts) }] : [];
    });
  }
  const head = s.timeline[headIndex(s.timeline)];
  const p = head?.sha === undefined ? undefined : profiles(head.sha);
  if (!head || !p) return [];
  const main = statesOf(p.concepts);
  const phones = p.variants.flatMap((v): DeviceStates[] => {
    const devices = v.when.devices;
    return devices?.length ? [{ devices: [...devices], slug: head.slug, states: { ...main, ...statesOf(v.concepts) } }] : [];
  });
  return [{ slug: head.slug, states: main }, ...phones];
}

/* ------------------------------------------------------------------ output */

function releaseSummaries(releases: readonly Release[]): ReleaseSummary[] {
  return [...releases]
    .sort((a, b) => (b.released ?? "").localeCompare(a.released ?? "") || compareReleases(b, a))
    .map((r) => ({
      platform: r.platform,
      id: r.id,
      version: r.version,
      ...(r.patch !== undefined ? { patch: r.patch } : {}),
      ...(r.released !== undefined ? { released: r.released } : {}),
      ...(r.prerelease !== undefined ? { prerelease: r.prerelease } : {}),
      devices: [...r.devices],
      sources: Object.keys(r.sources).length,
    }));
}

function carrierOf(g: LinkedGroup, slug: string): Carrier {
  const sims = new Map<string, SimMatcher>();
  for (const m of g.members) for (const s of m.sims) sims.set(matcherKey(s), s);
  return {
    slug,
    name: g.name,
    ...(g.iso !== undefined ? { iso: g.iso } : {}),
    members: g.members.map((m) => m.source),
    sims: [...sims.values()],
    links: [...g.links],
  };
}

function summaryOf(c: Carrier, info: ReadonlyMap<string, SourceInfo>, keys: readonly string[]): CarrierSummary {
  const platforms = [...new Set(c.members.map((m) => m.platform))].sort();
  const updated = keys.flatMap((k) => info.get(k)?.updated ?? []).sort().at(-1);
  return { slug: c.slug, name: c.name, ...(c.iso !== undefined ? { iso: c.iso } : {}), platforms, ...(updated !== undefined ? { updated } : {}), members: [...keys] };
}

export function buildIndexes(input: IndexInput): IndexOutput {
  const all = sources(input);
  const info = new Map(all.map((s) => [s.key, s]));
  const members = all.map((s) => member(s, input.iosManifestSims));
  const groups = linkSources(members);
  const slugs = assignSlugs(
    groups.map((g) => g.members.map((m) => ({ key: m.key, platform: m.source.platform, name: m.source.name, matchers: m.sims.length }))),
    input.previous?.sources,
  );

  const docs: CarrierDoc[] = [];
  const carriers: CarrierSummary[] = [];
  const sourceSlugs: Record<string, string> = {};
  const docOf = (carrier: Carrier, keys: readonly string[]): CarrierDoc => ({
    carrier,
    timelines: Object.fromEntries(keys.map((k) => [k, info.get(k)?.timeline ?? []])),
    states: Object.fromEntries(keys.flatMap((k) => { const s = info.get(k); return s ? [[k, deviceStates(s, input.profiles)]] : []; })),
  });

  groups.forEach((g, i) => {
    const slug = slugs[i] ?? "";
    const carrier = carrierOf(g, slug);
    const keys = g.members.map((m) => m.key);
    for (const k of keys) sourceSlugs[k] = slug;
    docs.push(docOf(carrier, keys));
    carriers.push(summaryOf(carrier, info, keys));
  });

  // Country bundles: one document per iOS country bundle name (phone and Watch families together), keyed by that name as v1 was.
  const countryBundles = new Map<string, LinkMember[]>();
  for (const m of members) {
    if (m.source.kind === "country") countryBundles.set(m.source.name, [...(countryBundles.get(m.source.name) ?? []), m]);
  }
  const countryKeysByIso = new Map<string, string[]>();
  for (const [name, list] of countryBundles) {
    const iso = list.flatMap((m) => m.iso)[0];
    const keys = list.map((m) => m.key);
    const carrier: Carrier = { slug: name, name: list[0]?.display ?? name, ...(iso !== undefined ? { iso } : {}), members: list.map((m) => m.source), sims: [], links: [] };
    for (const k of keys) sourceSlugs[k] = name;
    if (iso !== undefined) countryKeysByIso.set(iso, [...(countryKeysByIso.get(iso) ?? []), ...keys]);
    docs.push(docOf(carrier, keys));
  }

  const isos = new Set([...countryKeysByIso.keys(), ...carriers.flatMap((c) => c.iso ?? [])]);
  const countries: CountrySummary[] = [...isos].sort().map((iso) => ({
    iso,
    name: countryName(iso) ?? iso.toUpperCase(),
    countryBundles: countryKeysByIso.get(iso) ?? [],
    carriers: carriers.filter((c) => c.iso === iso).map((c) => c.slug).sort(),
  }));

  return {
    releases: releaseSummaries(input.releases),
    carriers: carriers.sort((a, b) => a.slug.localeCompare(b.slug)),
    docs: docs.sort((a, b) => a.carrier.slug.localeCompare(b.carrier.slug)),
    countries,
    sources: sourceSlugs,
  };
}
