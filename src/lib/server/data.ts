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
import {
  MODEM_SUMMARY_SCHEMA, basebandComparable, carriedBy, compareBundles, contentId, decodeFile, decodedPlist, decodedPri,
  diffKeyed, diffValues, isRecord, mergeComboSets, openIpcc, parseBandCombos, priReplacements, priText,
  summariseDiff,
  type BasebandSummary, type BundleFile, type ModemKind, type ModemSummary, type OpenedBundle, type PriReplacement,
} from "$lib/decode";
import { imageSlug, isPrerelease } from "$lib/names";
import { byNewest, homePhone, knowsPhone, overridesFor, sharedPri } from "$lib/phones";
import type { BasebandDiffPart, Kind, PublicEntry, TimelineEntry } from "$lib/types";
import { cached, digestHex, fetchApple, perRequest } from "./cache";
import { buildMergedCbsMatrix } from "./cbs";
import { guessCarrierQuery } from "./guess";
import {
  POINTER_KEY, bundlesKey, fileDataKey, fileIndexKey, keyScan, topKey,
  type ScanFileIndex, type ScanPointer, type ScanShard, type ScanTarget, type TargetRow,
} from "./keyscan";
import { MANIFEST_URL, countryName, manifestTables, parseManifest, splitName, type ManifestTables } from "./manifest";
import { firstCopyWith, modemView, overrideCandidates, summaryKey } from "./modems";
import { carriersOf, homeCountry, isoIndex, type CountryPlists } from "./related";
import { buildTimeline, headIndex, type ImageBuild, type ImageIndex } from "./timeline";

/* ------------------------------------------------------------------ images */

const bucket = () => {
  const b = getRequestEvent().platform?.env.SYSTEM;
  if (!b) error(500, "R2 bucket binding SYSTEM is missing");
  return b;
};

async function r2json<T>(key: string): Promise<T | null> {
  const obj = await bucket().get(key);
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

/** The current release's country plists. */
async function releasePlists(): Promise<CountryPlists> {
  const newest = release(await builds());
  return (newest && (await countryPlists(newest.build))) ?? {};
}

/** Distinguishes one list of images from another in a cache key. */
const buildsKey = (all: ImageBuild[]) => fingerprint(all.map((b) => `${b.build}@${b.extractedAt}`));

/* ---------------------------------------------------------------- manifest */

const MANIFEST_TTL = 6 * 3600;

/** Which six-hour window a manifest fetch falls in; everything derived from the manifest is keyed by it. */
const manifestSlot = () => Math.floor(Date.now() / (MANIFEST_TTL * 1000));

/** The manifest's tables. The plist is 6 MB, so it is parsed once per window and the tables are kept in the colo cache. */
const manifest = perRequest(() =>
  cached(`manifest:v1:${manifestSlot()}`, MANIFEST_TTL, async (): Promise<ManifestTables & { fetchedAt: string }> => {
    const res = await fetch(MANIFEST_URL, { cf: { cacheTtl: MANIFEST_TTL, cacheEverything: true } });
    if (!res.ok) error(502, `manifest fetch failed: ${res.status}`);
    const tables = manifestTables(parseManifest(new Uint8Array(await res.arrayBuffer())));
    return { ...tables, fetchedAt: new Date().toISOString() };
  }));

/* ------------------------------------------------------------------- lists */

export interface ListEntry {
  name: string;
  display: string;
  cc?: string;
  /** Bundle build inside the current release image, when it ships there. */
  image?: string;
  /** Distinct OTA builds published. */
  ota: number;
}

/** Every bundle name. Built from the manifest and every image, so it is kept per manifest window and image set. */
export const getIndex = perRequest(async () => {
  const all = await builds();
  return cached(`index:v1:${manifestSlot()}:${buildsKey(all)}`, MANIFEST_TTL, async () => {
    const [m, images] = await Promise.all([manifest(), imageIndexes()]);
    const newest = images.find((i) => i.build === release(all)?.build);

    const carriers = new Map<string, ListEntry>();
    for (const c of m.index.carriers) {
      carriers.set(c.name, { name: c.name, display: c.display, cc: c.cc, ota: c.versions.length + (c.hasLegacy ? 1 : 0) });
    }
    for (const img of images) {
      for (const name of Object.keys(img.carriers)) {
        if (!carriers.has(name)) carriers.set(name, { name, ...splitName(name), ota: 0 });
      }
    }

    const countries = new Map<string, ListEntry>();
    for (const c of m.index.countries) {
      if (c.family !== "iPhone") continue;
      const e = countries.get(c.id) ?? { name: c.id, display: c.id, ota: 0 };
      e.ota++;
      countries.set(c.id, e);
    }
    for (const img of images) {
      for (const name of Object.keys(img.countries)) {
        if (!countries.has(name)) countries.set(name, { name, display: name, ota: 0 });
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
      watch: m.index.watchCarriers.map((c): ListEntry => ({ name: c.name, display: c.display, cc: c.cc, ota: c.versions.length })),
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

export const getTimeline = perRequest(async (kind: Kind, name: string): Promise<TimelineEntry[]> => {
  const [m, images] = await Promise.all([manifest(), imageIndexes()]);
  const refs = Object.hasOwn(m.refs, name) ? m.refs[name] : [];
  const out = buildTimeline(kind, name, images, refs, m.index.countries);
  if (!out.length) error(404, `no bundle named ${name}`);
  return out;
});

async function resolve(kind: Kind, name: string, slug?: string) {
  const timeline = await getTimeline(kind, name);
  const i = slug
    ? timeline.findIndex((e) => e.slug === slug || (e.source === "image" && e.ios.some((v) => imageSlug(v) === slug)))
    : headIndex(timeline);
  if (i < 0) error(404, `${name} has no version ${slug}`);
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
    const obj = await bucket().get(`blobs/${src.slice(5)}.ipcc`);
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
  const [{ entry }, all] = await Promise.all([resolve(kind, name, slug), builds()]);
  const build = entry.image ?? release(all)?.build;
  return { entry, build: build ?? null, idx: build ? await imageIndex(build) : null };
}

type PhoneFile = Pick<BundleFile, "path" | "kind" | "devices">;

/** OTA copies one lookup may open for a phone's files before settling on "none". */
const OTA_COPIES = 8;

/**
 * The copy of a bundle version that carries `phone`'s modem override files:
 * the version itself when it has them, else the OTA copy found by
 * overrideCandidates. `slug` is empty for the head. Without one, `known` says
 * whether a copy made while the phone existed was read (so it has none), and
 * null means a copy could not be read.
 */
const phoneCopy = perRequest(async (kind: Kind, name: string, slug: string, phone: string) => {
  const { timeline, entry } = await resolve(kind, name, slug || undefined);
  const head = timeline[headIndex(timeline)];
  // A new head can bring new OTA copies, so it is part of the key.
  const hit = await cached(`phonecopy:v3:${head.src}|${entry.src}|${phone}`, 7 * 86400, async () => {
    const found = await firstCopyWith(
      overrideCandidates(timeline, entry, phone, OTA_COPIES),
      async (e) => (await open(e.src)).opened.info.files,
      (files) => overridesFor(files, phone),
      (files) => knowsPhone(files, phone),
    );
    // A copy that could not be read may hold the files: not an answer to keep.
    if (found === undefined) return null;
    if (!found.entry) return { slug: null, files: [], known: found.known, settled: true };
    const files: PhoneFile[] = found.files.map(({ path, kind, devices }) => ({ path, kind, devices }));
    return { slug: found.entry.slug, files, known: true, settled: found.settled };
  }, (v) => !!v?.settled);
  const copy = hit?.slug ? timeline.find((e) => e.slug === hit.slug) : undefined;
  if (!hit) return null;
  return copy ? { entry: copy, files: hit.files, sameCopy: copy.slug === entry.slug } : { entry: null, known: hit.known };
});

/**
 * A bundle version's modem override files, each with the phones that read it
 * and the copy it was read from (see phoneCopy), and the phones left over:
 * `defaults` have none, `unknown` have no copy of this bundle made for them.
 * Phones newest family first; `home` is the phone the version means.
 */
export async function getBundleOverrides(kind: Kind, name: string, slug?: string) {
  const { entry, build, idx } = await bundleImage(kind, name, slug);
  if (!build || !idx) return null;
  const phones = byNewest(idx.modems.map(modemView)).flatMap((m) => m.devices.map((d) => ({ ...d, family: m.family })));
  const copies = await Promise.all(phones.map((p) => phoneCopy(kind, name, slug ?? "", p.id)));
  type Phone = (typeof phones)[number];
  const files = new Map<string, { slug: string; source: PublicEntry["source"]; ios: string[]; build: string; path: string; phones: Phone[] }>();
  const defaults: Phone[] = [], unknown: Phone[] = [];
  phones.forEach((p, i) => {
    const c = copies[i];
    if (!c?.entry) return void (c?.known ? defaults : unknown).push(p);
    for (const f of c.files) {
      const key = `${c.entry.slug}\0${f.path}`;
      const { slug: s, source, ios, build: b } = c.entry;
      if (!files.has(key)) files.set(key, { slug: s, source, ios, build: b, path: f.path, phones: [] });
      files.get(key)!.phones.push(p);
    }
  });
  return { build, home: homePhone(entry, idx), files: [...files.values()], defaults, unknown };
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
  const copy = (await phoneCopy(kind, name, slug ?? "", phone))?.entry ?? entry;
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
  const obj = await bucket().get(fileDataKey(gen, file), { range: { offset, length } });
  return obj ? obj.json<ScanShard>() : null;
}

/** Head bundle of every carrier (or country) in scope, in parallel. */
async function scanTargets(scope: string): Promise<ScanTarget[]> {
  const idx = await getIndex();
  const kind: Kind = scope === "countries" ? "countries" : "carriers";
  const cc = scope.startsWith("country:") ? scope.slice(8) : null;
  const names = idx[kind].filter((e) => !cc || e.cc === cc);
  const targets = await Promise.all(names.map(async (e): Promise<ScanTarget | null> => {
    const t = await getTimeline(kind, e.name).catch(() => null);
    const head = t?.[headIndex(t)];
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

/** FNV-1a over a set of strings: a cache key part that changes when any member does. */
function fingerprint(xs: string[]): string {
  let h = 0x811c9dc5;
  for (const x of xs) for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + xs.length;
}

/* ----------------------------------------------------------------- guesses */

/** A country search guessed from where the request came from. */
export async function guessCountry(): Promise<string | null> {
  const { platform, locals } = getRequestEvent();
  // Same bargain as the carrier guess: this is the visitor's own location.
  locals.perVisitor = true;
  const cc = platform?.cf?.country?.toLowerCase();
  if (!cc) return null;
  const [{ countries }, plists] = await Promise.all([getIndex(), releasePlists()]);
  const hit = isoIndex(plists).get(cc);
  if (hit && countries.some((c) => c.name === hit)) return hit;
  // Territories and, without countries.json, everything else: Apple's bundle
  // names are the English name with the spaces taken out. Accents are folded
  // rather than dropped, or Réunion would not reach Reunion.
  const flat = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const name = countryName(cc);
  return (name && countries.find((c) => flat(c.name) === flat(name))?.name) || null;
}

/** On a phone, a carrier search guessed from the network the request came in on. */
export async function guessCarrier(): Promise<string | null> {
  const { request, platform, locals } = getRequestEvent();
  // The answer is the visitor's own network and device, so whatever rendered it
  // is theirs alone. A remote function cannot set a header, but it shares locals
  // with the page event, and hooks.server.ts reads this before it decides.
  locals.perVisitor = true;
  if (!/Mobi|Android|iPhone/i.test(request.headers.get("user-agent") ?? "")) return null;
  return guessCarrierQuery(platform?.cf?.asOrganization, (await getIndex()).carriers);
}
