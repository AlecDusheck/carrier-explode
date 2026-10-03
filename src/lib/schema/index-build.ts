/** Everything under index/, as one pure function. The extractor's `index` job writes it; the site reads it. */

import { carrierName, countryDisplay, countryName, splitName } from "#lib/names.ts";
import type { CarrierSummary, CountrySummary, OtaRef, ReleaseSummary } from "#lib/storage/keys.ts";
import { conceptById } from "./concepts.ts";
import { linkSources, primary, type LinkMember, type LinkedGroup } from "./identity.ts";
import { legacyRoutes } from "./legacy.ts";
import { isoForCountryName, isoForMcc } from "./mcc.ts";
import { assignIds } from "./slug.ts";
import { compareReleases, deviceGroups, head, sourceTimeline } from "./timeline.ts";
import {
  decoderFamily, matcherKey, parseSourceKey,
  type Carrier, type CarrierDoc, type ConceptValue, type DeviceStates, type FeatureState, type LegacyRoute, type Profile,
  type Release, type SimMatcher, type SourceRef, type Timeline, type TimelineEntry,
} from "./types.ts";

export interface IndexInput {
  readonly releases: readonly Release[];
  readonly otaRefs: readonly OtaRef[];
  readonly profiles: (sha: string) => Profile | undefined;
  /** The previous run's index/sources.json; absent on the first build. */
  readonly previous?: { readonly sources: Readonly<Record<string, string>> };
  /** Apple's SIM routes per sourceKey, from the current manifest (`manifestSims`). */
  readonly manifestSims: Readonly<Record<string, readonly SimMatcher[]>>;
}

export interface IndexOutput {
  readonly releases: ReleaseSummary[];
  readonly carriers: CarrierSummary[];
  readonly docs: CarrierDoc[];
  readonly countries: CountrySummary[];
  /** sourceKey -> carrier id. */
  readonly sources: Record<string, string>;
  readonly legacy: LegacyRoute[];
}

interface SourceInfo {
  readonly key: string;
  readonly ref: SourceRef;
  readonly timeline: Timeline;
  /** YYYY-MM-DD of the newest change on any line. */
  readonly updated: string | undefined;
  readonly profile: Profile | undefined;
}

const lines = (t: Timeline): Array<readonly TimelineEntry[]> =>
  t.family === "apple" ? [t.entries, ...Object.values(t.models)] : Object.values(t.devices);

const profileOf = (e: TimelineEntry, profiles: IndexInput["profiles"]): Profile | undefined => {
  for (const c of e.copies) {
    const sha = c.via === "image" ? c.sha : c.archive.state === "archived" ? c.archive.sha : undefined;
    const p = sha === undefined ? undefined : profiles(sha);
    if (p) return p;
  }
  return undefined;
};

/** The head's profile, else the newest one held on the head's line (the head may be an unarchived OTA file). */
function headProfile(t: Timeline, profiles: IndexInput["profiles"]): Profile | undefined {
  const h = head(t);
  if (!h) return undefined;
  const entries = t.family === "apple" ? (h.line === undefined ? t.entries : t.models[h.line] ?? []) : t.devices[h.line ?? ""] ?? [];
  return entries.slice(Math.max(0, entries.indexOf(h.entry))).map((e) => profileOf(e, profiles)).find((p) => p !== undefined);
}

function dayOf(e: TimelineEntry, releases: ReadonlyMap<string, Release>): string | undefined {
  const days = e.copies.flatMap((c) => (c.via === "image" ? c.releases.flatMap((id) => releases.get(id)?.released ?? []) : c.published ?? []));
  return days.sort()[0]?.slice(0, 10);
}

function sources(input: IndexInput, releases: ReadonlyMap<string, Release>): SourceInfo[] {
  const keys = new Set<string>([...input.releases.flatMap((r) => Object.keys(r.sources)), ...input.otaRefs.map((r) => r.source)]);
  return [...keys].sort().map((key): SourceInfo => {
    const ref = parseSourceKey(key);
    if (!ref) throw new Error(`index: malformed source key ${key}`);
    const timeline = sourceTimeline(ref, input.releases, input.otaRefs);
    const updated = lines(timeline).flat().flatMap((e) => (e.changed ? dayOf(e, releases) ?? [] : [])).sort().at(-1);
    return { key, ref, timeline, updated, profile: headProfile(timeline, input.profiles) };
  });
}

/** Name and ISO from the source name alone, for a source with no stored profile yet. */
function nameIdentity(ref: SourceRef): { display: string; iso: string[] } {
  if (decoderFamily(ref.platform) === "apple") {
    const iso = ref.kind === "country" ? isoForCountryName(ref.name) : splitName(ref.name).cc;
    return { display: ref.kind === "country" ? countryDisplay(ref.name) : carrierName(ref.name).brand, iso: iso ? [iso] : [] };
  }
  const cc = /_([a-z]{2})$/.exec(ref.name)?.[1];
  const iso = cc !== undefined && countryName(cc) !== undefined ? cc : isoForMcc(ref.name);
  return { display: ref.name, iso: iso ? [iso] : [] };
}

function member(s: SourceInfo, manifest: IndexInput["manifestSims"]): LinkMember {
  const named = nameIdentity(s.ref);
  const sims = new Map<string, SimMatcher>();
  for (const m of [...(s.profile?.identity.sims ?? []), ...(manifest[s.key] ?? [])]) sims.set(matcherKey(m), m);
  return {
    key: s.key,
    source: s.ref,
    sims: [...sims.values()],
    display: s.profile?.identity.display ?? named.display,
    iso: s.profile?.identity.iso.length ? s.profile.identity.iso : named.iso,
  };
}

function statesOf(concepts: Readonly<Record<string, ConceptValue>>): Record<string, FeatureState> {
  const out: Record<string, FeatureState> = {};
  for (const [id, v] of Object.entries(concepts)) {
    if (v.kind === "state" && conceptById(id)?.type === "state") out[id] = v.state;
  }
  return out;
}

/** Android: one group per file the newest build ships. Apple: the head for every phone, then each per-phone variant. */
function deviceStates(s: SourceInfo, releases: readonly Release[], profiles: IndexInput["profiles"]): DeviceStates[] {
  if (s.timeline.family === "android") {
    return deviceGroups(s.ref, releases, s.timeline).flatMap((g): DeviceStates[] => {
      const p = profileOf(g.entry, profiles);
      return p ? [{ devices: [...g.devices], slug: g.entry.slug, line: g.line, states: statesOf(p.concepts) }] : [];
    });
  }
  const h = head(s.timeline);
  const p = h === undefined ? undefined : profileOf(h.entry, profiles);
  if (!h || !p) return [];
  const main = statesOf(p.concepts);
  const phones = p.variants.flatMap((v): DeviceStates[] =>
    v.when.by === "device" ? [{ devices: [...v.when.devices], slug: h.entry.slug, states: { ...main, ...statesOf(v.concepts) } }] : []);
  return [{ devices: "rest", slug: h.entry.slug, states: main }, ...phones];
}

function releaseSummary(r: Release): ReleaseSummary {
  const base = {
    id: r.id, version: r.version, ...(r.released !== undefined ? { released: r.released } : {}),
    prerelease: r.prerelease, devices: r.devices, extractedAt: r.extractedAt, sourceCount: Object.keys(r.sources).length,
  };
  return r.platform === "android" ? { ...base, platform: r.platform, patch: r.patch } : { ...base, platform: r.platform };
}

function carrierOf(g: LinkedGroup, id: string): Carrier {
  const sims = new Map<string, SimMatcher>();
  for (const m of g.members) for (const s of m.sims) sims.set(matcherKey(s), s);
  return { id, name: g.name, ...(g.iso !== undefined ? { iso: g.iso } : {}), members: g.members.map((m) => m.source), sims: [...sims.values()], links: g.links };
}

function summaryOf(c: Carrier, info: ReadonlyMap<string, SourceInfo>, keys: readonly string[]): CarrierSummary {
  const platforms = [...new Set(c.members.map((m) => m.platform))].sort();
  const updated = keys.flatMap((k) => info.get(k)?.updated ?? []).sort().at(-1);
  return { id: c.id, name: c.name, ...(c.iso !== undefined ? { iso: c.iso } : {}), platforms, ...(updated !== undefined ? { updated } : {}), members: keys };
}

/** Members with the one the carrier is named after first. */
function primaryFirst(members: readonly LinkMember[]): LinkMember[] {
  const p = primary(members);
  return p ? [p, ...members.filter((m) => m !== p)] : [...members];
}

export function buildIndexes(input: IndexInput): IndexOutput {
  const releasesById = new Map(input.releases.map((r) => [r.id, r]));
  const all = sources(input, releasesById);
  const info = new Map(all.map((s) => [s.key, s]));
  const members = all.map((s) => member(s, input.manifestSims));
  const groups = linkSources(members);
  const ids = assignIds(
    groups.map((g) => primaryFirst(g.members).map((m) => ({ key: m.key, platform: m.source.platform, name: m.source.name }))),
    input.previous?.sources,
  );

  const docs: CarrierDoc[] = [];
  const carriers: CarrierSummary[] = [];
  const sourceIds: Record<string, string> = {};
  const docOf = (carrier: Carrier, keys: readonly string[]): CarrierDoc => {
    const known = keys.flatMap((k) => info.get(k) ?? []);
    return {
      carrier,
      timelines: Object.fromEntries(known.map((s) => [s.key, s.timeline])),
      states: Object.fromEntries(known.map((s) => [s.key, deviceStates(s, input.releases, input.profiles)])),
    };
  };

  groups.forEach((g, i) => {
    const carrier = carrierOf(g, ids[i] ?? "");
    const keys = g.members.map((m) => m.key);
    for (const k of keys) sourceIds[k] = carrier.id;
    docs.push(docOf(carrier, keys));
    carriers.push(summaryOf(carrier, info, keys));
  });

  // Country bundles are not carriers: one document per bundle name, iPhone and Watch alike.
  const byName = new Map<string, LinkMember[]>();
  for (const m of members) {
    if (m.source.kind === "country") byName.set(m.source.name, [...(byName.get(m.source.name) ?? []), m]);
  }
  const countryKeysByIso = new Map<string, string[]>();
  for (const [name, list] of byName) {
    const iso = list.flatMap((m) => m.iso)[0];
    const keys = list.map((m) => m.key);
    const carrier: Carrier = { id: `country-${name}`, name: list[0]?.display ?? name, ...(iso !== undefined ? { iso } : {}), members: list.map((m) => m.source), sims: [], links: [] };
    for (const k of keys) sourceIds[k] = carrier.id;
    if (iso !== undefined) countryKeysByIso.set(iso, [...(countryKeysByIso.get(iso) ?? []), ...keys]);
    docs.push(docOf(carrier, keys));
  }

  const isos = new Set([...countryKeysByIso.keys(), ...carriers.flatMap((c) => c.iso ?? [])]);
  const countries = [...isos].sort().map((iso): CountrySummary => ({
    iso,
    name: countryName(iso) ?? iso.toUpperCase(),
    countryBundles: countryKeysByIso.get(iso) ?? [],
    carriers: carriers.filter((c) => c.iso === iso).map((c) => c.id).sort(),
  }));

  return {
    releases: [...input.releases].sort((a, b) => (b.released ?? "").localeCompare(a.released ?? "") || compareReleases(b, a)).map(releaseSummary),
    carriers: carriers.sort((a, b) => a.id.localeCompare(b.id)),
    docs: docs.sort((a, b) => a.carrier.id.localeCompare(b.carrier.id)),
    countries,
    sources: sourceIds,
    legacy: legacyRoutes(input.releases, input.otaRefs, new Map(all.map((s) => [s.key, s.timeline]))),
  };
}
