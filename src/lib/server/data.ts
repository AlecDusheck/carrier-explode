/**
 * Everything the app reads, in one place.
 *
 * Two sources. iOS images, extracted by .github/workflows/system-bundles.yml
 * into R2, are the base: they are what a phone boots with and they cover every
 * country. Apple's OTA manifest fills in around them: bundles pushed since an
 * image was cut, older history, Watch bundles, carriers no image carries.
 *
 * A bundle's history is one timeline across both, ordered by the bundle's own
 * build number, which is how the phone decides which one wins.
 */

import { error } from "@sveltejs/kit";
import { getRequestEvent } from "$app/server";
import { env } from "cloudflare:workers";
import {
  MODEM_SUMMARY_SCHEMA, basebandComparable, carriedBy, comparable, compareBundles, contentId, decodeFile, decodedPlist, decodedPri,
  diffKeyed, diffValues, isRecord, mergeComboSets, openIpcc, parseBandCombos, priReplacements, priText,
  summariseDiff,
  type BasebandSummary, type BundleFile, type DiffCounts, type DiffRow, type ModemKind, type ModemSummary, type OpenedBundle,
  type PriReplacement,
} from "#lib/decode/index.ts";
import { compareVersions, countryCode, fold, imageSlug, isPrerelease } from "#lib/names.ts";
import { byNewest, compareProducts, homePhone, knowsPhone, overridesFor, sharedPri } from "#lib/phones.ts";
import { FEATURES, featureBySlug } from "#lib/features.ts";
import { featuresKey, phoneFeature, type FeatureIndex } from "./featureindex";
import type { BasebandDiffPart, Kind, PublicEntry, TimelineEntry } from "#lib/types.ts";
import { cached, digestHex, fetchApple, perRequest } from "./cache";
import { buildMergedCbsMatrix } from "./cbs";
import { guessCarrierBundle, guessCarrierQuery } from "./guess";
import {
  POINTER_KEY, bundlesKey, fileDataKey, fileIndexKey, keyScan, rareKey, topKey, type RareSetting,
  type ScanFileIndex, type ScanPointer, type ScanShard, type ScanTarget, type TargetRow,
} from "./keyscan";
import { MANIFEST_URL, countryName, manifestTables, parseManifest, publishedOn, splitName, type BundleRef } from "./manifest";
import { firstCopyWith, modemView, overrideCandidates, summaryKey, type ModemView } from "./modems";
import { carriersOf, homeCountry, isoIndex, type CountryPlists } from "./related";
import { buildTimeline, headIndex, imageDate, type ImageBuild, type ImageIndex } from "./timeline";

/* ------------------------------------------------------------------ images */

async function r2json<T>(key: string): Promise<T | null> {
  const obj = await env.SYSTEM.get(key);
  return obj ? obj.json<T>() : null;
}

/** Newest first. Read on every request that needs it: the ingest purges pages the moment it uploads. */
export const builds = perRequest(async () => (await r2json<ImageBuild[]>("system/builds.json")) ?? []);

/**
 * The newest image that is not a beta: what "current" means for the lists, the
 * status bar and the cross-country tables. Betas sit in builds() and in each
 * bundle's timeline, but a beta is not what most phones are running.
 */
export const release = (all: ImageBuild[]) => all.find((b) => !isPrerelease(b.version)) ?? all[0];

/** baseband.yml rewrites an index to fill in its modems, so indexes are read, not cached. */
const imageIndex = perRequest((build: string) => r2json<ImageIndex>(`system/${build}/index.json`));

const imageIndexes = perRequest(async () => {
  const all = await Promise.all((await builds()).map((b) => imageIndex(b.build)));
  return all.filter((x): x is ImageIndex => !!x);
});

/** Every country carrier.plist of an image, decoded. */
const countryPlists = perRequest((build: string) => r2json<CountryPlists>(`system/${build}/countries.json`));

/**
 * The current release's country plists, cut to the ISO codes: all that the
 * links between carriers and countries read. The whole file is 200 KB and a
 * bundle page needs it every time, so the cut is kept per extraction.
 */
const releasePlists = perRequest(async (): Promise<CountryPlists> => {
  const newest = release(await builds());
  if (!newest) return {};
  const cut = await cached(`countryiso:v1:${newest.build}@${newest.extractedAt}`, 30 * 86400, async () => {
    const all = await countryPlists(newest.build);
    return all && Object.fromEntries(Object.entries(all).map(([c, p]) => [c, { ISOAlpha2CountryCode: p.ISOAlpha2CountryCode }]));
  });
  return cut ?? {};
});

/** Distinguishes one list of images from another in a cache key. */
const buildsKey = (all: ImageBuild[]) => fingerprint(all.map((b) => `${b.build}@${b.extractedAt}`));

/* ---------------------------------------------------------------- manifest */

/**
 * Apple's OTA manifest, read at most once per ten-minute window. Apple's own CDN
 * can hand out a copy hours old, so the window goes in the URL to reach a fresh
 * one. Its contents' hash keys everything parsed or derived from it, so the 6 MB
 * plist is parsed again only when Apple changes it.
 */
const MANIFEST_TTL = 600;
/** Derived data is keyed by the manifest's hash; the TTL only bounds the cache. */
const KEEP = 30 * 86400;

/** Why a bundle or version that does exist can be missing. */
const NOT_LISTED_YET = "If Apple only just published it, it can take up to an hour to show up here.";

const manifestWindow = () => Math.floor(Date.now() / (MANIFEST_TTL * 1000));

const manifestBytes = perRequest(async () => {
  const res = await fetch(`${MANIFEST_URL}?w=${manifestWindow()}`, { cf: { cacheTtl: MANIFEST_TTL, cacheEverything: true } });
  if (!res.ok) error(502, `manifest fetch failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
});

/** Which manifest is current: a hash of its contents, worked out once per window. */
const manifestVersion = perRequest(() =>
  cached(`manifesthash:${manifestWindow()}`, MANIFEST_TTL, async () => digestHex("SHA-1", await manifestBytes())));

/** The manifest's tables. */
const manifest = perRequest(async () => {
  const version = await manifestVersion();
  return cached(`manifest:v4:${version}`, KEEP, async () => manifestTables(parseManifest(await manifestBytes())))
    .then((tables) => ({ ...tables, fetchedAt: tables.index.fetchedAt }));
});

/** How big the manifest's tables are, for the wiki. */
export const getManifestFacts = perRequest(async () => {
  const version = await manifestVersion();
  return cached(`manifestfacts:v4:${version}`, KEEP, async () => {
    const m = await manifest();
    return { counts: m.index.counts, fetchedAt: m.fetchedAt };
  });
});

/* ------------------------------------------------------------------- lists */

export interface ListEntry {
  name: string;
  display: string;
  cc?: string;
  /** Bundle build inside the current release image, when it ships there. */
  image?: string;
  /** Distinct OTA builds published. */
  ota: number;
  /** YYYY-MM-DD (or YYYY, see publishedOn): the newer of its newest published file and the image where its contents last changed. */
  updated?: string;
}

/** The newest of some YYYY-MM-DD (or YYYY) dates. */
const newestDate = (dates: Array<string | undefined>) =>
  dates.reduce<string | undefined>((a, d) => (d && (!a || d > a) ? d : a), undefined);

/** Per bundle name, the date of the image where its contents last changed, walking images oldest first. */
function imageChanges(images: ImageIndex[], kind: "carriers" | "countries") {
  const last = new Map<string, { id: string; date: string }>();
  for (const img of [...images].sort((a, b) => imageDate(a).localeCompare(imageDate(b)))) {
    for (const [name, b] of Object.entries(img[kind])) {
      // Ids only compare within one hashing scheme, so a new scheme counts as a change.
      const id = `${img.scheme ?? 1}:${b.id}`;
      if (last.get(name)?.id !== id) last.set(name, { id, date: imageDate(img) });
    }
  }
  return new Map([...last].map(([name, v]) => [name, v.date]));
}

/** The day the newest of these files was published. */
const newestPublished = (refs: BundleRef[] = []) => newestDate(refs.map((r) => publishedOn(r.url)));

/** Every bundle name. Built from the manifest and every image, so it is kept per manifest window and image set. */
export const getIndex = perRequest(async () => {
  const all = await builds();
  const version = await manifestVersion();
  return cached(`index:v6:${version}:${buildsKey(all)}`, KEEP, async () => {
    const [m, images] = await Promise.all([manifest(), imageIndexes()]);
    const newest = images.find((i) => i.build === release(all)?.build);

    const changed = imageChanges(images, "carriers");
    const phone = (name: string) => m.refs[name]?.filter((r) => r.productType !== "Watch");
    const carriers = new Map<string, ListEntry>();
    for (const c of m.index.carriers) {
      carriers.set(c.name, { name: c.name, display: c.display, cc: c.cc, ota: c.versions.length + (c.hasLegacy ? 1 : 0) });
    }
    for (const img of images) {
      for (const name of Object.keys(img.carriers)) {
        if (!carriers.has(name)) carriers.set(name, { name, ...splitName(name), ota: 0 });
      }
    }
    for (const e of carriers.values()) e.updated = newestDate([newestPublished(phone(e.name)), changed.get(e.name)]);

    const countries = new Map<string, ListEntry>();
    for (const c of m.index.countries) {
      if (c.family !== "iPhone") continue;
      const e = countries.get(c.id) ?? { name: c.id, display: c.id, cc: countryCode(c.id), ota: 0 };
      e.ota++;
      countries.set(c.id, e);
    }
    for (const img of images) {
      for (const name of Object.keys(img.countries)) {
        if (!countries.has(name)) countries.set(name, { name, display: name, cc: countryCode(name), ota: 0 });
      }
    }

    // Every name in the newest image went into the maps above.
    const withImage = (list: Map<string, ListEntry>, held: Record<string, { build: string }> = {}) =>
      [...list.values()]
        .map((e) => (Object.hasOwn(held, e.name) ? { ...e, image: held[e.name].build } : e))
        .sort((a, b) => a.name.localeCompare(b.name));
    return {
      carriers: withImage(carriers, newest?.carriers),
      countries: withImage(countries, newest?.countries),
      watch: m.index.watchCarriers.map((c): ListEntry => ({
        name: c.name, display: c.display, cc: c.cc, ota: c.versions.length,
        updated: newestPublished(m.refs[c.name]?.filter((r) => r.productType === "Watch")),
      })),
      builds: all,
      manifestFetchedAt: m.fetchedAt,
    };
  });
});

/** Just the numbers the chrome shows. Awaiting getIndex() anywhere puts the
 *  whole list in the page for hydration; this is a few bytes instead. */
export async function getStats() {
  const idx = await getIndex();
  const newest = release(idx.builds);
  const beta = idx.builds[0] && isPrerelease(idx.builds[0].version) ? idx.builds[0] : undefined;
  return {
    carriers: idx.carriers.length,
    countries: idx.countries.length,
    watch: idx.watch.length,
    build: newest?.build,
    version: newest?.version,
    beta: beta && { build: beta.build, version: beta.version },
  };
}

/* ---------------------------------------------------------------- timeline */

/**
 * Built from the whole manifest and every image index — megabytes of JSON — so
 * a page keeps its one bundle's result instead. Uncached here: a scan builds
 * every bundle's in one request, and the inputs are already in hand after the first.
 */
const timelineOf = perRequest(async (kind: Kind, name: string): Promise<TimelineEntry[]> => {
  const [m, images] = await Promise.all([manifest(), imageIndexes()]);
  const refs = Object.hasOwn(m.refs, name) ? m.refs[name] : [];
  return buildTimeline(kind, name, images, refs, m.index.countries);
});

/**
 * One bundle's history, kept as long as its inputs: the manifest window and the
 * image set. baseband.yml only rewrites an index's modems, which a timeline
 * does not read. An unknown name is kept too, so a typo costs one build.
 */
export const getTimeline = perRequest(async (kind: Kind, name: string): Promise<TimelineEntry[]> => {
  const all = await builds();
  const version = await manifestVersion();
  const out = await cached(`timeline:v3:${version}:${buildsKey(all)}:${kind}:${name}`, KEEP,
    () => timelineOf(kind, name), () => true);
  if (!out.length) error(404, `No bundle named ${name}. ${NOT_LISTED_YET}`);
  return out;
});

/** The version a bundle's page opens on, without opening it: what a wiki link names. */
export async function getHead(kind: Kind, name: string) {
  const timeline = await getTimeline(kind, name);
  const { slug, build, ios, source } = timeline[headIndex(timeline)];
  return { slug, build, ios, source };
}

async function resolve(kind: Kind, name: string, slug?: string) {
  const timeline = await getTimeline(kind, name);
  const i = slug
    ? timeline.findIndex((e) => e.slug === slug || (e.source === "image" && e.ios.some((v) => imageSlug(v) === slug)))
    : headIndex(timeline);
  if (i < 0) error(404, `${name} has no version ${slug}. ${NOT_LISTED_YET}`);
  // "Previous" skips per-model variants unless we are on one.
  const entry = timeline[i];
  const previous = timeline.slice(i + 1).find((e) => e.productType === entry.productType) ?? null;
  return { timeline, entry, previous };
}

/** Timeline entry without the storage location, plus the Apple URL when there is one. */
function publicEntry({ src, ...rest }: TimelineEntry): PublicEntry {
  return { ...rest, url: src.startsWith("blob:") ? null : src };
}

/* ----------------------------------------------------------------- bundles */

/** A bundle's bytes and zip index. Several queries of one page read the same bundle, so it is opened once per request. */
const open = perRequest(async (src: string) => {
  let bytes: Uint8Array<ArrayBuffer>;
  if (src.startsWith("blob:")) {
    const obj = await env.SYSTEM.get(`blobs/${src.slice(5)}.ipcc`);
    if (!obj) error(404, "bundle is not in the bucket");
    bytes = new Uint8Array(await obj.arrayBuffer());
  } else {
    bytes = await fetchApple(src);
  }
  return { opened: openIpcc(bytes), bytes };
});

/** A decoded .der.pri, or undefined when the file is not one or does not decode. */
function readPri(opened: OpenedBundle, path: string) {
  try {
    return decodedPri(decodeFile(opened, path));
  } catch {
    return undefined;
  }
}

export async function getBundle(kind: Kind, name: string, slug?: string) {
  const { timeline, entry, previous } = await resolve(kind, name, slug);
  const [{ opened, bytes }, plists, carriers] = await Promise.all([
    open(entry.src),
    releasePlists(),
    kind === "countries" ? getIndex().then((i) => i.carriers) : [],
  ]);
  const [id, sha1, sha384] = await Promise.all([contentId(opened), digestHex("SHA-1", bytes), digestHex("SHA-384", bytes)]);
  const quick: Record<string, unknown> = {};
  for (const f of ["carrier.plist", "Info.plist", "version.plist"]) {
    if (opened.info.files.some((x) => x.path === f)) {
      try { quick[f] = decodedPlist(decodeFile(opened, f)); } catch { /* shown as undecodable in Files */ }
    }
  }
  const cc = kind === "countries" ? undefined : splitName(name).cc;
  const carrierPlist = quick["carrier.plist"];
  const related = kind === "countries"
    ? { country: null, carriers: carriersOf(name, plists, carriers) }
    : { country: homeCountry(isRecord(carrierPlist) ? carrierPlist : undefined, cc, new Set(Object.keys(plists)), isoIndex(plists)), carriers: [] };
  return {
    related,
    kind, name, cc, countryName: countryName(cc),
    entry: publicEntry(entry),
    previous: previous && publicEntry(previous),
    timeline: timeline.map(publicEntry),
    /** The version phones on a release run: the newest plain, non-beta copy. */
    head: timeline[headIndex(timeline)].slug,
    info: opened.info,
    downloadSize: bytes.length,
    contentId: id,
    sha1,
    sha384,
    // Image bundles are checked against their content id; OTA ones against the digest Apple publishes.
    verified: entry.id ? entry.id === id : entry.sha1 ? entry.sha1 === sha1 : entry.sha384 ? entry.sha384 === sha384 : null,
    quick,
  };
}

export async function getFile(kind: Kind, name: string, slug: string, path: string) {
  const { entry } = await resolve(kind, name, slug);
  const { opened } = await open(entry.src);
  try {
    return decodeFile(opened, path);
  } catch (e) {
    error(404, e instanceof Error ? e.message : String(e));
  }
}

export async function getRaw(kind: Kind, name: string, slug: string, path: string) {
  const { entry } = await resolve(kind, name, slug);
  const { opened } = await open(entry.src);
  const bytes = opened.entries[opened.prefix + path];
  if (!bytes) error(404, `no such file: ${path}`);
  return { bytes };
}

/* ----------------------------------------------------------------- compare */

export interface Side { kind: Kind; name: string; slug?: string }

/**
 * `b` against `a`, file by file; the one diff behind both /compare and a
 * version's Changes tab. Without `a`, `b` is compared to the version before it.
 * Content never changes under a src, so results are cached for a month.
 */
export async function getComparison(a: Side | null, b: Side, path?: string) {
  const [rb, ra] = await Promise.all([resolve(b.kind, b.name, b.slug), a && resolve(a.kind, a.name, a.slug)]);
  const right = { ...b, entry: rb.entry };
  const left = a && ra ? { ...a, entry: ra.entry } : rb.previous ? { ...b, entry: rb.previous } : null;
  const side = (s: typeof right) => ({ kind: s.kind, name: s.name, entry: publicEntry(s.entry) });
  if (!left) return { a: null, b: side(right), diff: null };
  return cached(`compare:v1:${left.entry.src}|${right.entry.src}|${path ?? ""}`, 30 * 86400, async () => {
    const [A, B] = await Promise.all([open(left.entry.src), open(right.entry.src)]);
    const diff = compareBundles(A.opened, B.opened, { path, maxRows: path ? 2000 : 400 });
    return { a: side(left), b: side(right), diff };
  });
}

/** One override file of a phone group, against what that phone had before. */
export interface PhoneFileChange {
  /** The file in this version, and in the copy compared against. */
  path: string;
  before?: string;
  kind: "same" | "changed" | "added" | "removed";
  counts: DiffCounts;
  rows: DiffRow[];
  truncated: boolean;
}

export interface PhoneChange {
  phones: Array<{ id: string; name?: string; family?: string }>;
  /**
   * "compared": against the version compared against itself. "older": that version's copy has no files for
   * this phone, so against `from`, the newest copy before it that does; the difference spans more than one update.
   * "new": copies from then knew the phone and gave it no files. "unknown": no copy that old has a file for it.
   */
  status: "compared" | "older" | "new" | "unknown";
  from?: PublicEntry;
  plist?: PhoneFileChange;
  modem?: PhoneFileChange;
}

const PHONE_ROWS = 300;
const isPhonePlist = (f: Pick<BundleFile, "path">) => /^overrides_.+\.plist$/.test(f.path);
const isPhoneModem = (f: Pick<BundleFile, "kind">) => f.kind === "pri-der" || f.kind === "pri-plain";

function fileChange(A: OpenedBundle | null, before: string | undefined, B: OpenedBundle, path: string | undefined): PhoneFileChange | undefined {
  const value = (o: OpenedBundle, p: string) => { try { return comparable(decodeFile(o, p)); } catch { return null; } };
  if (!path && !before) return undefined;
  if (!path) return { path: before!, before, kind: "removed", counts: summariseDiff([]), rows: [], truncated: false };
  if (!A || !before) return { path, kind: "added", counts: summariseDiff([]), rows: [], truncated: false };
  const rows = diffValues(value(A, before), value(B, path));
  return { path, before, kind: rows.length ? "changed" : "same", counts: summariseDiff(rows), rows: rows.slice(0, PHONE_ROWS), truncated: rows.length > PHONE_ROWS };
}

/**
 * A version's phone groups, each one's override plist and modem file against what that phone
 * had at the version compared against: that version's own files when it carries them, else the
 * newest copy no newer than it that does. An image copy carries only its own phones' files, so
 * comparing two copies file by file reports every other phone as added; this compares per phone.
 */
export async function getPhoneChanges(kind: Kind, name: string, slug: string, against?: string) {
  const { timeline, entry: b, previous } = await resolve(kind, name, slug);
  const a = against ? (await resolve(kind, name, against)).entry : previous;
  const vb = await phoneCopies(kind, name, slug);
  if (!a || !vb) return null;
  // What a phone could have had at `a`: `a`, then OTA copies no newer than it, newest first.
  const candidates = [a, ...timeline
    .filter((e) => e !== a && e.source === "ota" && !e.beta && compareVersions(e.build || "0", a.build || "0") <= 0)
    .sort((x, y) => compareVersions(y.build || "0", x.build || "0"))].slice(0, OTA_COPIES + 1);
  const key = `phonechanges:v2:${b.src}|${fingerprint(candidates.map((e) => e.src))}|${fingerprint(vb.phones.map((p) => p.id))}`;
  return cached(key, 30 * 86400, async () => {
    const B = (await open(b.src)).opened;
    /** A phone's override files in a copy: its plist and its modem file, by the boards in their names. */
    const filesFor = (o: OpenedBundle, phone: string) => o.info.files.filter((f) => f.devices?.some((d) => d.ids === phone));
    // Phone groups as this version files them: phones that read the same files.
    const groups = new Map<string, { files: BundleFile[]; phones: PhoneChange["phones"] }>();
    for (const p of vb.phones) {
      const files = filesFor(B, p.id);
      if (!files.length) continue;
      const k = files.map((f) => f.path).sort().join("|");
      const g = groups.get(k) ?? { files, phones: [] };
      g.phones.push({ id: p.id, name: p.name, family: p.family });
      groups.set(k, g);
    }
    const out: PhoneChange[] = [];
    for (const { files, phones } of groups.values()) {
      const phone = phones[0].id;
      let found: { entry: TimelineEntry; files: BundleFile[]; opened: OpenedBundle } | undefined;
      let knew = false;
      for (const e of candidates) {
        // A per-model copy only speaks for its own model.
        if (e.productType && e.productType !== phone) continue;
        const opened = (await open(e.src)).opened;
        const mine = filesFor(opened, phone);
        if (mine.length) { found = { entry: e, files: mine, opened }; break; }
        knew ||= knowsPhone(opened.info.files, phone);
      }
      const before = found?.files ?? [];
      out.push({
        phones,
        status: found ? (found.entry === a ? "compared" : "older") : knew ? "new" : "unknown",
        from: found && publicEntry(found.entry),
        plist: fileChange(found?.opened ?? null, before.find(isPhonePlist)?.path, B, files.find(isPhonePlist)?.path),
        modem: fileChange(found?.opened ?? null, before.find(isPhoneModem)?.path, B, files.find(isPhoneModem)?.path),
      });
    }
    return { from: publicEntry(a), groups: out };
  });
}

/** Bundles added, removed and changed between an image and the one before it. */
export async function getRelease(build: string) {
  const all = await builds();
  const i = all.findIndex((b) => b.build === build);
  if (i < 0) error(404, `no image ${build}`);
  const [now, before] = await Promise.all([imageIndex(build), all[i + 1] ? imageIndex(all[i + 1].build) : null]);
  if (!now) error(404, `no image ${build}`);
  const comparable = !!before && (now.scheme ?? 1) === (before.scheme ?? 1);
  const compare = (kind: "carriers" | "countries") => {
    const n = now[kind], p = before?.[kind] ?? {};
    return {
      total: Object.keys(n).length,
      added: Object.keys(n).filter((k) => !(k in p)).sort(),
      removed: Object.keys(p).filter((k) => !(k in n)).sort(),
      changed: Object.keys(n).filter((k) => k in p && (comparable ? p[k].id !== n[k].id : p[k].build !== n[k].build)).sort()
        .map((k) => ({ name: k, from: p[k].build, to: n[k].build })),
    };
  };
  return { image: all[i], previous: all[i + 1] ?? null, carriers: compare("carriers"), countries: compare("countries") };
}

/* ---------------------------------------------------------------- baseband */

/**
 * Package summaries, keyed by package (summaryKey). Written by the workflows,
 * never here; baseband.yml rewrites them after a decoder change and purges the
 * "baseband" page tag when it does.
 */
const modemSummary = perRequest((id: string) => r2json<ModemSummary>(summaryKey(id)));

async function mustSummary(id: string) {
  const s = await modemSummary(id);
  if (!s) error(404, `No summary for modem package ${id}.`);
  return s;
}

async function mustBbfw(id: string) {
  const s = await mustSummary(id);
  if (s.kind !== "bbfw") error(404, `${id} is not a .bbfw package`);
  return s;
}

async function mustIndex(build: string) {
  const idx = await imageIndex(build);
  if (!idx) error(404, `no image ${build}`);
  return idx;
}

/** The image's package of `family`. */
async function imageModem(build: string, family: string, kind: ModemKind) {
  const idx = await mustIndex(build);
  const m = idx.modems.find((x) => x.family === family && x.package.kind === kind);
  if (!m) error(404, `iOS ${idx.version} (${build}) has no ${family} ${kind === "bbfw" ? ".bbfw" : "ftab"} modem package.`);
  return { idx, m };
}

/** A build's modem packages, one per distinct package, with the phones each serves; newest phones first. */
export async function getModems(build: string) {
  const idx = await mustIndex(build);
  return { build, version: idx.version, modems: byNewest(idx.modems.map(modemView)) };
}

/** Every image, and the modem families it holds. */
export const basebandBuilds = async () =>
  (await imageIndexes()).map((i) => ({ build: i.build, version: i.version, families: i.modems.map((m) => m.family) }));

type MccCountries = Record<string, { cc: string; name?: string }>;

/** MCC to country code, by the bundles the manifest routes each PLMN to. */
async function mccCountries(mccs: Iterable<string>): Promise<MccCountries> {
  const votes = new Map<string, Map<string, number>>();
  for (const e of (await getPlmn()).entries) {
    const cc = e.bundle && splitName(e.bundle).cc;
    if (!cc || e.mcc === "901") continue; // 901 is international: satellite, roaming SIMs
    const m = votes.get(e.mcc) ?? new Map<string, number>();
    m.set(cc, (m.get(cc) ?? 0) + 1);
    votes.set(e.mcc, m);
  }
  const out: MccCountries = {};
  for (const mcc of mccs) {
    const best = [...(votes.get(mcc) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) out[mcc] = { cc: best, name: countryName(best) };
  }
  return out;
}

/** The page's view of a .bbfw package: everything but file contents and NV values. */
async function bbfwView(s: BasebandSummary) {
  const mccs = new Set([
    ...s.amprNs.flatMap((a) => a.groups.flatMap((g) => g.mccs)),
    ...(s.mdb?.databases ?? []).flatMap((d) => d.scan?.flatMap((e) => (e.mcc ? [e.mcc] : [])) ?? []),
  ]);
  return {
    kind: s.kind,
    package: s.package,
    members: s.members,
    // The header metadata is build-system placeholders apart from the version the page already names.
    containers: s.containers.map(({ meta: _meta, ...c }) => c),
    files: s.files.map(({ text, hex: _h, ...f }, i) => ({ ...f, i, readable: text !== undefined })),
    nv: s.nv.map(({ records, ...n }) => ({
      ...n,
      records: records.map(({ nv, efs, hex, name, meaning, label, confidence }) => ({ nv, efs, hex, name, meaning, label, confidence })),
    })),
    images: s.images,
    bandCombos: s.bandCombos,
    amprNs: s.amprNs,
    // Country names are a nicety; the page is whole without them.
    mccs: await mccCountries(mccs).catch((): MccCountries => ({})),
    modemConfigs: s.modemConfigs ?? null,
    carrierMap: s.carrierMap ?? null,
    mdb: s.mdb ?? null,
    ssgccs: s.ssgccs ?? null,
  };
}

/** What a package page without a full view shows: the package header, and an ftab's entry table. */
export async function getModemPackageHeader(id: string) {
  const s = await mustSummary(id);
  return s.kind === "ftab" ? s : { kind: s.kind, package: s.package };
}

/** An image's .bbfw package of `family`. */
export async function getBaseband(build: string, family: string) {
  const { idx, m } = await imageModem(build, family, "bbfw");
  const view = await bbfwView(await mustBbfw(m.package.id));
  return { build, version: idx.version, family: m.family, id: m.package.id, ...view };
}

export async function getBasebandFile(id: string, i: number) {
  const f = (await mustBbfw(id)).files[i];
  if (!f) error(404, `no file ${i} in modem package ${id}`);
  return { ...f, i };
}

/** One carrier's combo strings from one band_combos_per_plmn.xml variant. */
export async function getBasebandCombos(id: string, sha1: string, tag: string) {
  const f = (await mustBbfw(id)).files.find((x) => x.sha1 === sha1 && x.path.endsWith("/band_combos_per_plmn.xml"));
  if (!f?.text) error(404, `no band combo file ${sha1}`);
  const c = parseBandCombos(f.text).find((x) => x.tag === tag);
  if (!c) error(404, `no ${tag} in ${sha1}`);
  return c.combos;
}

/** One family's package in build `b` against build `a`, part by part. A package pair is cached for a month. */
export async function getBasebandDiff(a: string, b: string, family: string) {
  const [A, B] = await Promise.all([imageModem(a, family, "bbfw"), imageModem(b, family, "bbfw")]);
  const side = (x: typeof A) => ({ build: x.idx.build, version: x.idx.version, id: x.m.package.id });
  const diff = await cached(`bbdiff:v${MODEM_SUMMARY_SCHEMA}:${A.m.package.id}|${B.m.package.id}`, 30 * 86400, async () => {
    const [ca, cb] = (await Promise.all([mustBbfw(A.m.package.id), mustBbfw(B.m.package.id)])).map(basebandComparable);
    const parts: BasebandDiffPart[] = Object.keys(cb).flatMap((section) =>
      diffKeyed(ca[section] ?? {}, cb[section], { maxRows: 300 }).map((p) => ({ section, ...p })));
    return { parts, counts: summariseDiff(parts) };
  });
  return { family, a: side(A), b: side(B), ...diff };
}

/**
 * The image a bundle version is read against: its own for an image entry, the
 * current release for OTA.
 */
async function bundleImage(kind: Kind, name: string, slug?: string) {
  const [{ timeline, entry }, all] = await Promise.all([resolve(kind, name, slug), builds()]);
  const build = entry.image ?? release(all)?.build;
  return { timeline, entry, build: build ?? null, idx: build ? await imageIndex(build) : null };
}

type PhoneFile = Pick<BundleFile, "path" | "kind" | "devices">;
type Phone = ModemView["devices"][number] & { family: string };

/** OTA copies one phone's lookup may open before settling on "none". */
const OTA_COPIES = 8;

/**
 * Every phone of a bundle version's image, newest family first, with the copy
 * that carries its modem override files: the version itself when it has them,
 * else the OTA copy found by overrideCandidates. Without one, `known` says
 * whether a copy made while the phone existed was read (so it has none), and
 * null means a copy could not be read. `slug` is empty for the head.
 *
 * Kept per version, head (a new one can bring new OTA copies) and phone list
 * (baseband.yml can change it), once no unreadable copy could change an answer.
 */
const phoneCopies = perRequest(async (kind: Kind, name: string, slug: string) => {
  const { timeline, entry, build, idx } = await bundleImage(kind, name, slug || undefined);
  if (!build || !idx) return null;
  const phones: Phone[] = byNewest(idx.modems.map(modemView)).flatMap((m) => m.devices.map((d) => ({ ...d, family: m.family })));
  const head = timeline[headIndex(timeline)];
  const key = `phonecopies:v2:${head.src}|${entry.src}|${fingerprint(phones.map((p) => `${p.family}/${p.id}`))}`;
  const { found } = await cached(key, 7 * 86400, async () => {
    const found = await Promise.all(phones.map((p) => firstCopyWith(
      overrideCandidates(timeline, entry, p.id, OTA_COPIES),
      async (e) => (await open(e.src)).opened.info.files,
      (files) => overridesFor(files, p.id),
      (files) => knowsPhone(files, p.id),
    )));
    return {
      found: found.map((f) => !f ? null : f.entry
        ? { slug: f.entry.slug, files: f.files.map(({ path, kind, devices }): PhoneFile => ({ path, kind, devices })), known: true }
        : { slug: null, files: [], known: f.known }),
      settled: found.every((f) => f && (!f.entry || f.settled)),
    };
  }, (v) => v.settled);
  const copies = found.map((f) => f && { ...f, entry: timeline.find((e) => e.slug === f.slug) });
  return { entry, build, idx, phones, copies };
});

/**
 * A bundle version's modem override files, each with the phones that read it
 * and the copy it was read from (see phoneCopies), and the phones left over:
 * `defaults` have none, `unknown` have no copy of this bundle made for them.
 * Phones newest family first; `home` is the phone the version means.
 */
export async function getBundleOverrides(kind: Kind, name: string, slug?: string) {
  const v = await phoneCopies(kind, name, slug ?? "");
  if (!v) return null;
  const files = new Map<string, { slug: string; source: PublicEntry["source"]; ios: string[]; build: string; path: string; phones: Phone[] }>();
  const defaults: Phone[] = [], unknown: Phone[] = [];
  v.phones.forEach((p, i) => {
    const c = v.copies[i];
    if (!c?.entry) return void (c?.known ? defaults : unknown).push(p);
    for (const f of c.files) {
      const key = `${c.entry.slug}\0${f.path}`;
      const { slug: s, source, ios, build: b } = c.entry;
      if (!files.has(key)) files.set(key, { slug: s, source, ios, build: b, path: f.path, phones: [] });
      files.get(key)!.phones.push(p);
    }
  });
  return { build: v.build, home: homePhone(v.entry, v.idx), files: [...files.values()], defaults, unknown };
}

/**
 * What the modem of `device` runs for this bundle before the bundle's own
 * .der.pri lands: the band-combo carrier tags whose PLMNs route here, and the
 * package files that phone's .der.pri replaces by EFS path. Without `device`,
 * the entry's home phone.
 */
export async function getBasebandDefaults(kind: Kind, name: string, slug?: string, device?: string) {
  const { entry, build, idx } = await bundleImage(kind, name, slug);
  const phone = idx && (device ?? homePhone(entry, idx));
  const m = idx && phone ? idx.modems.find((x) => x.devices.includes(phone) && x.package.kind === "bbfw") : undefined;
  if (!build || !idx || !phone || !m) return { build, missing: true as const };
  // The phone's .der.pri may only be in another copy of the bundle; compare against that one.
  const v = await phoneCopies(kind, name, slug ?? "");
  const copy = v?.copies[v.phones.findIndex((p) => p.id === phone)]?.entry ?? entry;
  const [s, { opened }] = await Promise.all([modemSummary(m.package.id), open(copy.src)]);
  if (s?.kind !== "bbfw") return { build, missing: true as const };

  const tags = Object.entries(s.carrierMap ?? {})
    .filter(([, c]) => c.bundles.includes(name) || c.mvnoBundles.includes(name))
    .map(([tag, c]) => ({ tag, plmns: c.plmns, primary: c.bundles.includes(name), sets: mergeComboSets(s.bandCombos, tag) }));

  const own = new Set([...overridesFor(opened.info.files, phone), ...sharedPri(opened.info.files)].map((f) => f.path));
  const overrides: Array<{ pri: string } & PriReplacement> = [];
  let otherXml = 0;
  for (const file of opened.info.files) {
    if (file.kind !== "pri-der" || !own.has(file.path)) continue;
    const pri = readPri(opened, file.path);
    if (!pri) continue;
    const r = priReplacements(pri, s);
    overrides.push(...r.replaced.map((x) => ({ pri: file.path, ...x })));
    otherXml += r.otherXml;
  }
  return {
    build, missing: false as const, version: idx.version, family: m.family, id: m.package.id, phone, tags, overrides, otherXml,
    /** The copy the .der.pri files were read from, for getBasebandOverride. */
    slug: copy.slug,
  };
}

/** File `i` of modem package `id` next to the .der.pri value that replaces it, with the lines that differ. */
export async function getBasebandOverride(kind: Kind, name: string, slug: string | undefined, id: string, pri: string, efs: string, i: number) {
  const [{ entry }, s] = await Promise.all([resolve(kind, name, slug), mustBbfw(id)]);
  const base = s.files[i];
  if (!base?.text || base.path !== efs) error(404, `no package file ${i} at ${efs}`);
  const { opened } = await open(entry.src);
  const v = readPri(opened, pri)?.efs.find((e) => e.path === efs)?.value;
  const text = v && priText(v);
  if (text === undefined) error(404, `${pri} does not set ${efs}`);
  const rows = diffValues(base.text.split("\n"), text.split("\n"));
  return { id, efs, pri, where: carriedBy(base), member: base.member, baseline: base.text, override: text, rows, counts: summariseDiff(rows) };
}

/* ------------------------------------------------------------ cross-cutting */

/** Every country's cell-broadcast settings: the current release's, and newer OTA ones. Rebuilt daily. */
export async function getCbs() {
  const newest = release(await builds());
  const day = new Date().toISOString().slice(0, 10);
  return cached(`cbs:v3:${newest?.build ?? "ota"}:${day}`, 86400, async () => {
    const [m, idx, plists] = await Promise.all([
      manifest(),
      newest ? imageIndex(newest.build) : null,
      newest ? countryPlists(newest.build) : null,
    ]);
    const image = idx && plists
      ? { version: idx.version, build: idx.build, plists,
          builds: Object.fromEntries(Object.entries(idx.countries).map(([k, v]) => [k, v.build])) }
      : null;
    return buildMergedCbsMatrix(image, m.index.countries, fetchApple);
  });
}

export const getPlmn = async () => (await manifest()).plmn;

/* -------------------------------------------------------------------- scan */

/** One shard, by range read out of the file's packed data object. */
async function scanShard(gen: string, file: string, [offset, length]: [number, number]) {
  const obj = await env.SYSTEM.get(fileDataKey(gen, file), { range: { offset, length } });
  return obj ? obj.json<ScanShard>() : null;
}

/** Head bundle of every carrier (or country) in scope, in parallel. */
async function scanTargets(scope: string): Promise<ScanTarget[]> {
  const idx = await getIndex();
  const kind: Kind = scope === "countries" ? "countries" : "carriers";
  const cc = scope.startsWith("country:") ? scope.slice(8) : null;
  const names = idx[kind].filter((e) => !cc || e.cc === cc);
  const targets = await Promise.all(names.map(async (e): Promise<ScanTarget | null> => {
    const t = await timelineOf(kind, e.name);
    const head = t[headIndex(t)];
    return head ? { name: e.name, display: e.display, cc: e.cc, os: head.ios.at(-1) ?? "", build: head.build, src: head.src } : null;
  }));
  return targets.filter((t): t is ScanTarget => !!t);
}

/**
 * Every bundle in scope's value at `path` in `file`. `path` may use `[*]` for
 * any index and `*` for any key. Covers the whole scope: no limit.
 */
export async function scanKey(path: string, file: string, scope: string) {
  // The pointer is written by the workflow, never here.
  const [targets, pointer] = await Promise.all([scanTargets(scope), r2json<ScanPointer>(POINTER_KEY)]);
  const top = topKey(path);
  const key = `scan:v3:${pointer?.gen ?? "none"}|${scope}|${file}|${path}|${fingerprint(targets.map((t) => t.src))}`;
  return cached(key, 86400, async () => {
    const rows: TargetRow[] = targets.map(() => undefined);
    if (pointer) {
      // Every src the generation indexed, so "lacks the file" can be told from "not indexed".
      const [indexed, fi] = await Promise.all([
        r2json<{ srcs: string[] }>(bundlesKey(pointer.gen)).then((b) => new Set(b?.srcs)),
        r2json<ScanFileIndex>(fileIndexKey(pointer.gen, file)),
      ]);
      const bySrc = new Map(targets.map((t, i) => [t.src, i]));
      targets.forEach((t, i) => { if (indexed.has(t.src)) rows[i] = null; });
      if (fi) {
        for (const src of fi.srcs) { const i = bySrc.get(src); if (i !== undefined) rows[i] = {}; }
        const loc = fi.shards[top];
        const shard = loc && (await scanShard(pointer.gen, file, loc));
        shard?.at.forEach((at, k) => { const i = bySrc.get(fi.srcs[at]); if (i !== undefined) rows[i] = shard.rows[k]; });
      }
    }
    return keyScan(targets, rows, file, path, scope);
  });
}

/**
 * A version's carrier.plist settings that at most a few other bundles of its kind share,
 * from the last index run. Only head versions are indexed; others get `indexed: false`.
 */
export async function getRare(kind: Kind, name: string, slug?: string) {
  const [{ entry }, pointer] = await Promise.all([resolve(kind, name, slug), r2json<ScanPointer>(POINTER_KEY)]);
  // "pending": the index run that writes the rarity file has not happened yet; "old": not a head version.
  if (!pointer) return { indexed: false as const, why: "pending" as const };
  const got = await cached(`rare:v1:${pointer.gen}:${entry.src}`, 86400, async () => {
    const all = await r2json<Record<string, RareSetting[]>>(rareKey(pointer.gen));
    return { built: !!all, rows: all?.[entry.src] ?? null };
  });
  if (!got.built) return { indexed: false as const, why: "pending" as const };
  return got.rows ? { indexed: true as const, rows: got.rows } : { indexed: false as const, why: "old" as const };
}

/** The last index run's feature index; null until a run has written one. */
const featureIndex = perRequest(async () => {
  const pointer = await r2json<ScanPointer>(POINTER_KEY);
  if (!pointer) return null;
  return cached(`features:v2:${pointer.gen}`, 86400, () => r2json<FeatureIndex>(featuresKey(pointer.gen)));
});

/** The phones a feature page can be asked about: the current release's iPhones that have a name, newest first. */
export async function featurePhones() {
  const b = release(await builds());
  if (!b) return [];
  const { modems } = await getModems(b.build);
  const phones = new Map<string, string>();
  for (const m of modems) for (const d of m.devices) if (d.name) phones.set(d.id, d.name);
  return [...phones].map(([id, name]) => ({ id, name })).sort((x, y) => compareProducts(y.id, x.id));
}

/** One feature for every carrier bundle, on one phone. */
export async function getFeatureTable(slug: string, phone: string) {
  if (!featureBySlug(slug)) error(404, `no feature ${slug}`);
  const [index, list] = await Promise.all([featureIndex(), getIndex()]);
  if (!index) return { indexed: false as const };
  const rows = list.carriers
    .filter((c) => Object.hasOwn(index.bundles, c.name))
    .map((c) => ({ name: c.name, display: c.display, cc: c.cc, state: phoneFeature(index, c.name, slug, phone) }));
  return { indexed: true as const, rows };
}

/** How many carrier bundles offer each feature on one phone. */
export async function getFeatureSummary(phone: string) {
  const index = await featureIndex();
  if (!index) return null;
  const names = Object.keys(index.bundles);
  return FEATURES.map((f) => {
    const counts = { on: 0, available: 0, no: 0, unknown: 0 };
    for (const n of names) counts[phoneFeature(index, n, f.slug, phone)]++;
    return { slug: f.slug, counts, of: names.length };
  });
}

/** A phone's override plist next to its modem file (same stem), decoded; null when the copy has none. */
export async function getOverridePlist(kind: Kind, name: string, slug: string, priPath: string) {
  const path = priPath.replace(/(\.der)?\.pri$/, ".plist");
  const { entry } = await resolve(kind, name, slug);
  const { opened } = await open(entry.src);
  if (!opened.info.files.some((f) => f.path === path)) return null;
  try { return { path, plist: decodedPlist(decodeFile(opened, path)) }; } catch { return null; }
}

/**
 * One setting across every bundle in scope, cut to what a wiki table shows: how
 * many bundles set it, the median of its numeric values, and every bundle that
 * holds the largest and the smallest. Built from scanKey, so it moves with each
 * index run.
 */
export async function settingSummary(path: string, file: string, scope: string) {
  const r = await scanKey(path, file, scope);
  const nums = r.hits
    .flatMap((h) => h.matches.map((m) => ({ name: h.name, value: m.value })))
    .filter((x): x is { name: string; value: number } => typeof x.value === "number")
    .sort((a, b) => a.value - b.value);
  const holders = (value: number | undefined) =>
    value === undefined ? null : { value, names: [...new Set(nums.filter((x) => x.value === value).map((x) => x.name))] };
  return {
    scanned: r.scanned,
    set: r.set,
    median: nums.length ? nums[Math.floor(nums.length / 2)].value : null,
    min: holders(nums[0]?.value),
    max: holders(nums.at(-1)?.value),
  };
}

/** FNV-1a over a set of strings: a cache key part that changes when any member does. */
function fingerprint(xs: string[]): string {
  let h = 0x811c9dc5;
  for (const x of xs) for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + xs.length;
}

/* ----------------------------------------------------------------- guesses */

/** A request as it reached the worker; Request alone also covers outgoing ones, whose `cf` differs. */
type IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

/** A country search guessed from where the request came from. */
export async function guessCountry(): Promise<string | null> {
  const { request, locals } = getRequestEvent();
  // Same bargain as the carrier guess: this is the visitor's own location.
  locals.perVisitor = true;
  const cc = (request as IncomingRequest).cf?.country?.toLowerCase();
  if (!cc) return null;
  const [{ countries }, plists] = await Promise.all([getIndex(), releasePlists()]);
  const hit = isoIndex(plists).get(cc);
  if (hit && countries.some((c) => c.name === hit)) return hit;
  // Territories and, without countries.json, everything else: Apple's bundle
  // names are the English name with the spaces taken out.
  const name = countryName(cc);
  return (name && countries.find((c) => fold(c.name) === fold(name))?.name) || null;
}

/** On a phone, the carrier bundle the visitor's network most likely is. */
export async function guessCarrierName(): Promise<string | null> {
  const query = await guessCarrier();
  return query && guessCarrierBundle(query, (await getIndex()).carriers, visitorCountry());
}

/** The visitor's country as an ISO code ("us"), from where the request came from. */
export function visitorCountry(): string | null {
  const { request, locals } = getRequestEvent();
  locals.perVisitor = true;
  return (request as IncomingRequest).cf?.country?.toLowerCase() ?? null;
}

/** On a phone, a carrier search guessed from the network the request came in on. */
export async function guessCarrier(): Promise<string | null> {
  const { request, locals } = getRequestEvent();
  // The answer is the visitor's own network and device, so whatever rendered it
  // is theirs alone. A remote function cannot set a header, but it shares locals
  // with the page event, and hooks.server.ts reads this before it decides.
  locals.perVisitor = true;
  if (!/Mobi|Android|iPhone/i.test(request.headers.get("user-agent") ?? "")) return null;
  return guessCarrierQuery((request as IncomingRequest).cf?.asOrganization, (await getIndex()).carriers);
}
