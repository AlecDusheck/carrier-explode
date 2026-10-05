/** Everything under index/, as one pure function. The extractor's `index` job writes it; the site reads it. */

import { androidDisplay, androidIso } from "./android/names.ts";
import { needs5G } from "./concepts.ts";
import { countryName } from "./countries.ts";
import { newestFirst, type DeviceOrder } from "./devices.ts";
import { assignIds } from "./ids.ts";
import { linkSources, primary, type LinkMember, type LinkedGroup } from "./identity.ts";
import { boardProducts, productOf } from "./ios/boards.ts";
import { legacyRoutes } from "./ios/legacy.ts";
import type { Label } from "./labels.ts";
import { appleDisplay, appleNameIso } from "./ios/names.ts";
import { boardRadios, type BoardRadios } from "./ios/radio.ts";
import { carrierModems, modemRadios, type IndexModemConfig } from "./modem-links.ts";
import { naming, type Naming } from "./naming.ts";
import { currentRelease, phoneStates } from "./phone-states.ts";
import { has5GBy, type RadioEvidence } from "./radio.ts";
import { releaseChanges } from "./release-changes.ts";
import { uniqueSims } from "./sims.ts";
import { compareReleases, head, pixelGroups, sourceTimeline } from "./timeline.ts";
import {
  decoderFamily, isSourceKey, RELEASE_PLATFORMS, sourceOf,
  type Carrier, type CarrierDoc, type CarrierSummary, type ConceptValue, type CountrySummary, type Device, type EntryRef, type FeatureState,
  type HeadStates, type LegacyRoute, type Line, type Name, type OtaFile, type Phone, type PhoneStates, type Profile, type ReleaseChange, type Release,
  type ReleaseSummary, type SimMatcher, type SourceKey, type SourceRef, type Timeline, type TimelineEntry,
} from "./types.ts";

/** What the index reads of a Profile; its raw leaves stay in norm/, so a build holds every head's without them. */
export type IndexProfile = Pick<Profile, "identity" | "concepts" | "variants"> & { readonly radios: BoardRadios };

export const indexProfile = (p: Profile): IndexProfile => ({ identity: p.identity, concepts: p.concepts, variants: p.variants, radios: boardRadios(p.raw) });

interface IndexInput {
  readonly releases: readonly Release[];
  readonly otaFiles: readonly OtaFile[];
  /** The feeds' device records: the order devices are listed in, and which phone each Apple board is. */
  readonly devices: readonly Device[];
  /** What the feeds, people and models say over the data: names, and release days. */
  readonly labels: readonly Label[];
  readonly profiles: (sha: string) => IndexProfile | undefined;
  /** The stored ModemConfig of an `android.modem-config` artifact. */
  readonly modemConfigs: (sha: string) => IndexModemConfig | undefined;
  /** Apple's SIM routes per source (`manifestSims`). */
  readonly manifestSims: Readonly<Partial<Record<SourceKey, readonly SimMatcher[]>>>;
  /** sourceKey -> the carrier id the last publish gave it, so a build keeps each carrier's id. */
  readonly carrierIds: Readonly<Record<string, string>>;
}

export interface IndexOutput {
  readonly releases: readonly ReleaseSummary[];
  readonly carriers: readonly CarrierSummary[];
  readonly docs: readonly CarrierDoc[];
  readonly countries: readonly CountrySummary[];
  /** sourceKey -> carrier id. */
  readonly sources: Readonly<Record<SourceKey, string>>;
  readonly legacy: readonly LegacyRoute[];
  /** What each current phone reads from each carrier source. */
  readonly phoneStates: readonly PhoneStates[];
  /** The current releases' phones, newest first. */
  readonly phones: readonly Phone[];
  /** The names of codes pages read from records other than these. */
  readonly names: readonly Name[];
  /** Release id → what it changed. */
  readonly changes: Readonly<Record<string, readonly ReleaseChange[]>>;
}

interface SourceInfo {
  readonly key: SourceKey;
  readonly ref: SourceRef;
  readonly timeline: Timeline;
  /** YYYY-MM-DD of the newest change on any line. */
  readonly updated: string | undefined;
  readonly profile: IndexProfile | undefined;
}

type Profiles = IndexInput["profiles"];

const lines = (t: Timeline): Line[] => (t.kind === "apple" ? [t.main, ...Object.values(t.models)] : Object.values(t.devices));

const profileOf = (e: TimelineEntry, profiles: Profiles): IndexProfile | undefined => profiles(e.sha);

const headProfile = (t: Timeline, profiles: Profiles): IndexProfile | undefined => {
  const h = head(t);
  return h === undefined ? undefined : profileOf(h.entry, profiles);
};

/** The entries buildIndexes reads a profile of: each source's head, and on Android the file each Pixel group ships. */
function profiledEntries(source: SourceRef, timeline: Timeline, releases: readonly Release[], order: DeviceOrder): TimelineEntry[] {
  const h = head(timeline);
  return [...(h === undefined ? [] : [h.entry]), ...pixelGroups(source, releases, timeline, order).map((g) => g.entry)];
}

/** The shas whose profiles buildIndexes reads, so a caller loads those and not every artifact. */
export function indexShas({ releases, otaFiles, devices, labels }: Pick<IndexInput, "releases" | "otaFiles" | "devices" | "labels">): string[] {
  const order = newestFirst(naming(labels, devices).devices);
  const keys = sourceKeys({ releases, otaFiles });
  return [...new Set(keys.flatMap((key) => {
    const ref = sourceOf(key);
    return profiledEntries(ref, sourceTimeline(ref, releases, otaFiles, order), releases, order).map((e) => e.sha);
  }))];
}

function dayOf(e: TimelineEntry, releases: ReadonlyMap<string, Release>): string | undefined {
  const days = e.copies.flatMap((c) => (c.kind === "image" ? c.releases.flatMap((id) => releases.get(id)?.released ?? []) : c.published ?? []));
  return days.sort()[0];
}

function sourceKeys(input: Pick<IndexInput, "releases" | "otaFiles">): SourceKey[] {
  const raw = new Set<string>([...input.releases.flatMap((r) => Object.keys(r.sources)), ...input.otaFiles.flatMap((f) => f.listings.map((l) => l.source))]);
  return [...raw].sort().map((k) => {
    if (!isSourceKey(k)) throw new Error(`index: malformed source key ${k}`);
    return k;
  });
}

function sources(input: IndexInput, releases: ReadonlyMap<string, Release>, order: DeviceOrder): SourceInfo[] {
  return sourceKeys(input).map((key): SourceInfo => {
    const ref = sourceOf(key);
    const timeline = sourceTimeline(ref, input.releases, input.otaFiles, order);
    const updated = lines(timeline).flat().flatMap((e) => (e.changed ? dayOf(e, releases) ?? [] : [])).sort().at(-1);
    return { key, ref, timeline, updated, profile: headProfile(timeline, input.profiles) };
  });
}

/** Name and countries from the source name alone, for a source with no profile yet. */
function nameIdentity(ref: SourceRef): { readonly display: string; readonly iso: readonly string[] } {
  if (decoderFamily(ref.platform) === "android") return { display: androidDisplay(ref.name, undefined), iso: androidIso(ref.name, []) };
  const iso = appleNameIso(ref);
  return { display: appleDisplay(ref), iso: iso === undefined ? [] : [iso] };
}

function member(s: SourceInfo, manifest: IndexInput["manifestSims"]): LinkMember {
  const named = nameIdentity(s.ref);
  const identity = s.profile?.identity;
  return {
    key: s.key,
    source: s.ref,
    sims: uniqueSims([...(identity?.sims ?? []), ...(manifest[s.key] ?? [])]),
    display: identity?.display ?? named.display,
    iso: identity !== undefined && identity.iso.length > 0 ? identity.iso : named.iso,
  };
}

function statesOf(concepts: Readonly<Record<string, ConceptValue>>): Record<string, FeatureState> {
  return Object.fromEntries(Object.entries(concepts).flatMap(([id, v]) => (v.kind === "state" ? [[id, v.state]] : [])));
}

/** Feature states on a phone without a 5G radio. */
const without5G = (states: Readonly<Record<string, FeatureState>>): Record<string, FeatureState> =>
  Object.fromEntries(Object.entries(states).map(([id, state]) => [id, needs5G(id) ? "no" : state]));

/** One group for `devices`, split by whether each has a 5G radio. */
function byRadio(devices: readonly string[], has5G: (device: string) => boolean, at: EntryRef, states: Readonly<Record<string, FeatureState>>): HeadStates[] {
  const group = (listed: readonly string[], groupStates: Readonly<Record<string, FeatureState>>): HeadStates[] => {
    const [first, ...rest] = listed;
    return first === undefined ? [] : [{ devices: { kind: "listed", devices: [first, ...rest] }, at, states: groupStates }];
  };
  return [...group(devices.filter(has5G), states), ...group(devices.filter((d) => !has5G(d)), without5G(states))];
}

/** What decides each phone's radio: the iPhone bundles' override plists, and the Pixels' modem configurations. */
function radioEvidence(all: readonly SourceInfo[], input: IndexInput): RadioEvidence {
  const products = boardProducts(input.devices);
  const radios = all.flatMap((s) => (s.ref.platform === "ios" && s.profile !== undefined ? [s.profile.radios] : []));
  const phones = (boards: readonly string[]): string[] => boards.flatMap((b) => productOf(products, b) ?? []);
  const pixels = modemRadios(input.releases, input.modemConfigs);
  return {
    configured: new Set([...radios.flatMap((r) => phones(r.configured)), ...pixels.configured]),
    fiveG: new Set([...radios.flatMap((r) => phones(r.fiveG)), ...pixels.fiveG]),
  };
}

type Has5G = (device: string) => boolean;

/** Android: a group per file the newest build ships. Apple: every phone, then each per-phone variant. LTE-only phones get their own groups. */
function headStates(s: SourceInfo, releases: readonly Release[], profiles: Profiles, order: DeviceOrder, has5G: Has5G): HeadStates[] {
  if (s.timeline.kind === "android") {
    return pixelGroups(s.ref, releases, s.timeline, order).flatMap((g): HeadStates[] => {
      const p = profileOf(g.entry, profiles);
      return p === undefined ? [] : byRadio(g.devices, has5G, { line: g.line, slug: g.entry.slug }, statesOf(p.concepts));
    });
  }
  const h = head(s.timeline);
  const p = h === undefined ? undefined : profileOf(h.entry, profiles);
  if (h === undefined || p === undefined) return [];
  const at = { line: h.line, slug: h.entry.slug };
  const main = statesOf(p.concepts);
  const variants = p.variants.flatMap((v) => (v.when.kind === "device" ? [{ devices: v.when.devices, states: { ...main, ...statesOf(v.concepts) } }] : []));
  const named = new Set(variants.flatMap((v) => v.devices));
  const released = [...new Set(releases.flatMap((r) => (r.platform === s.ref.platform ? r.devices : [])))].sort();
  const lteOnly = released.filter((d) => !named.has(d) && !has5G(d));
  return [
    { devices: { kind: "rest" }, at, states: main },
    ...byRadio(lteOnly, has5G, at, main),
    ...variants.flatMap((v) => byRadio(v.devices, has5G, at, v.states)),
  ];
}

function releaseSummary(r: Release, named: Naming, order: DeviceOrder): ReleaseSummary {
  const sourceCount = Object.keys(r.sources).length;
  const modemFamilies = named.modems(r);
  const { id, version, extractedAt } = r;
  const devices = r.devices.toSorted(order);
  const released = r.released === undefined ? {} : { released: r.released };
  return r.platform === "android"
    ? { platform: r.platform, id, version, devices, extractedAt, ...released, patch: r.patch, sourceCount, modemFamilies }
    : { platform: r.platform, id, version, devices, extractedAt, ...released, label: r.label, prerelease: r.prerelease, sourceCount, modemFamilies };
}

/** A carrier the data names only by one of its sources' names has no name of its own, so any label names it. */
function carrierOf(g: LinkedGroup, id: string, named: Naming): Carrier {
  return {
    id,
    name: named.carrier(id, g.name, !g.members.some((m) => m.source.name === g.name)),
    ...(g.iso === undefined ? {} : { iso: g.iso }),
    members: g.members.map((m) => m.key),
    sims: uniqueSims(g.members.flatMap((m) => m.sims)),
    links: g.links,
  };
}

function summaryOf(c: Carrier, info: ReadonlyMap<SourceKey, SourceInfo>): CarrierSummary {
  const platforms = [...new Set(c.members.flatMap((k) => info.get(k)?.ref.platform ?? []))].sort();
  const updated = c.members.flatMap((k) => info.get(k)?.updated ?? []).sort().at(-1);
  return { id: c.id, name: c.name, ...(c.iso === undefined ? {} : { iso: c.iso }), members: c.members, platforms, ...(updated === undefined ? {} : { updated }) };
}

/** Members with the one the carrier is named after first. */
function primaryFirst(members: readonly LinkMember[]): SourceRef[] {
  const p = primary(members);
  return (p === undefined ? members : [p, ...members.filter((m) => m !== p)]).map((m) => m.source);
}

export function buildIndexes(input: IndexInput): IndexOutput {
  const named = naming(input.labels, input.devices);
  const order = newestFirst(named.devices);
  const releasesById = new Map(input.releases.map((r) => [r.id, r]));
  const all = sources(input, releasesById, order);
  const has5G = has5GBy(radioEvidence(all, input));
  const info = new Map(all.map((s) => [s.key, s]));
  const members = all.map((s) => member(s, input.manifestSims));
  const groups = linkSources(members);
  const withIds = assignIds(groups, (g) => primaryFirst(g.members), input.carrierIds);

  const docs: CarrierDoc[] = [];
  const carriers: CarrierSummary[] = [];
  const sourceIds: Record<SourceKey, string> = {};
  const features: Record<SourceKey, readonly HeadStates[]> = {};
  const modemsOf = carrierModems(input.releases, input.modemConfigs, named.vendor, order);
  const docOf = (carrier: Carrier): CarrierDoc => ({
    carrier,
    sources: Object.fromEntries(carrier.members.flatMap((k): Array<[SourceKey, Timeline]> => {
      const s = info.get(k);
      return s === undefined ? [] : [[k, s.timeline]];
    })),
    modems: modemsOf(carrier.sims),
  });

  withIds.forEach(({ carrier: g, id }) => {
    const carrier = carrierOf(g, id, named);
    for (const k of carrier.members) sourceIds[k] = carrier.id;
    for (const k of carrier.members) {
      const s = info.get(k);
      if (s !== undefined) features[k] = headStates(s, input.releases, input.profiles, order, has5G);
    }
    docs.push(docOf(carrier));
    carriers.push(summaryOf(carrier, info));
  });

  // Country bundles are not carriers: one document per bundle name, iPhone and Watch alike.
  const byName = new Map<string, LinkMember[]>();
  for (const m of members) {
    if (m.source.kind === "country") byName.set(m.source.name, [...(byName.get(m.source.name) ?? []), m]);
  }
  const countrySources = new Map<string, SourceKey[]>();
  for (const [name, list] of byName) {
    const iso = list.flatMap((m) => m.iso)[0];
    const carrier: Carrier = { id: `country-${name}`, name: list[0]?.display ?? name, ...(iso === undefined ? {} : { iso }), members: list.map((m) => m.key), sims: [], links: [] };
    for (const k of carrier.members) sourceIds[k] = carrier.id;
    if (iso !== undefined) countrySources.set(iso, [...(countrySources.get(iso) ?? []), ...carrier.members]);
    docs.push(docOf(carrier));
  }

  const isos = new Set([...countrySources.keys(), ...carriers.flatMap((c) => c.iso ?? [])]);
  const countries = [...isos].sort().map((iso): CountrySummary => ({
    iso,
    name: countryName(iso) ?? iso.toUpperCase(),
    sources: countrySources.get(iso) ?? [],
    carriers: carriers.filter((c) => c.iso === iso).map((c) => c.id).sort(),
  }));

  const releases = [...input.releases].sort((a, b) => (b.released ?? "").localeCompare(a.released ?? "") || compareReleases(b, a)).map((r) => releaseSummary(r, named, order));
  return {
    releases,
    carriers: carriers.sort((a, b) => a.id.localeCompare(b.id)),
    docs: docs.sort((a, b) => a.carrier.id.localeCompare(b.carrier.id)),
    countries,
    sources: sourceIds,
    legacy: legacyRoutes(input.releases, input.otaFiles, new Map(all.map((s) => [s.key, s.timeline]))),
    phoneStates: phoneStates(releases, features),
    phones: RELEASE_PLATFORMS.flatMap((platform) =>
      (currentRelease(releases, platform)?.devices ?? []).map((code): Phone => ({ ...named.device(code), platform, has5G: has5G(code) }))),
    names: named.names(input.releases),
    changes: Object.fromEntries(releaseChanges(input.releases, (k) => {
      const s = info.get(k);
      if (s === undefined) throw new Error(`index: ${k} is in a release but not indexed`);
      return s.timeline;
    }, order)),
  };
}
