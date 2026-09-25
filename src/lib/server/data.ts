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
import { cached, fetchApple, memo, sha1Hex, sha384Hex } from "./cache";
import {
  MANIFEST_URL, buildIndex, buildMccMnc, carrierRefs, countryName, parseManifest, splitName,
  type BundleRef,
} from "./manifest";
import {
  BBCFG_FILE_TYPES, compareBundles, contentId, decodeFile, diffValues, openIpcc, parseBandCombos, summariseDiff,
  type BasebandFile, type BasebandSummary, type ComboStats, type DiffKind, type FileDiff, type Variant,
} from "$lib/decode";
import { buildMergedCbsMatrix } from "./cbs";
import { guessCarrierQuery } from "./guess";
import {
  POINTER_KEY, bundlesKey, fileDataKey, fileIndexKey, keyScan, topKey,
  type ScanFileIndex, type ScanPointer, type ScanShard, type ScanTarget, type TargetRow,
} from "./keyscan";
import { carriersOf, homeCountry, isoIndex, type CountryPlists } from "./related";
import { buildTimeline, headIndex, type ImageBuild, type ImageIndex, type TimelineEntry } from "./timeline";
import { imageSlug, isPrerelease } from "$lib/names";

export type { ImageBuild, TimelineEntry };

export type Kind = "carriers" | "countries" | "watch";

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

/** Newest first. */
export const builds = () =>
  // Short on purpose: the ingest purges the cache the moment it uploads, and a
  // longer memo would let a warm worker re-render the same stale page.
  memo("builds", 60_000, async () => {
    const list = await r2json<ImageBuild[]>("system/builds.json");
    return list?.length ? list : null;
  }).then((b) => b ?? []);

/**
 * The newest image that is not a beta: what "current" means for the lists, the
 * status bar and the cross-country tables. Betas sit in builds() and in each
 * bundle's timeline, but a beta is not what most phones are running.
 */
export const release = (all: ImageBuild[]) => all.find((b) => !isPrerelease(b.version)) ?? all[0];

/** An image's index never changes once written. */
const imageIndex = (build: string) =>
  memo(`image:${build}`, 24 * 3600_000, () => r2json<ImageIndex>(`system/${build}/index.json`));

async function imageIndexes(): Promise<ImageIndex[]> {
  const all = await Promise.all((await builds()).map((b) => imageIndex(b.build)));
  return all.filter((x): x is ImageIndex => !!x);
}

/** Every country carrier.plist from the current release, decoded. */
const countryPlists = async () => {
  const newest = release(await builds());
  if (!newest) return {} as CountryPlists;
  return (await memo(`countries:${newest.build}`, 24 * 3600_000, () =>
    r2json<CountryPlists>(`system/${newest.build}/countries.json`))) ?? {};
};

/* ---------------------------------------------------------------- manifest */

const manifest = () =>
  memo("manifest", 6 * 3600_000, async () => {
    const res = await fetch(MANIFEST_URL, { cf: { cacheTtl: 21600, cacheEverything: true } } as RequestInit);
    if (!res.ok) error(502, `manifest fetch failed: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const root = parseManifest(bytes);
    const index = buildIndex(root);
    const refs: Record<string, BundleRef[]> = {};
    for (const c of [...index.carriers, ...index.watchCarriers]) refs[c.name] ??= carrierRefs(root, c.name);
    return { index, refs, plmn: buildMccMnc(root), fetchedAt: new Date().toISOString() };
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
}

export async function getIndex() {
  const [m, images, all] = await Promise.all([manifest(), imageIndexes(), builds()]);
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
  for (const [name, b] of Object.entries(newest?.carriers ?? {})) carriers.get(name)!.image = b.build;

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
  for (const [name, b] of Object.entries(newest?.countries ?? {})) countries.get(name)!.image = b.build;

  const byName = (a: ListEntry, b: ListEntry) => a.name.localeCompare(b.name);
  return {
    carriers: [...carriers.values()].sort(byName),
    countries: [...countries.values()].sort(byName),
    watch: m.index.watchCarriers.map((c) => ({ name: c.name, display: c.display, cc: c.cc, ota: c.versions.length })),
    builds: all,
    manifestFetchedAt: m.fetchedAt,
  };
}

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

export async function getTimeline(kind: Kind, name: string): Promise<TimelineEntry[]> {
  const [m, images] = await Promise.all([manifest(), imageIndexes()]);
  const out = buildTimeline(kind, name, images, m.refs[name] ?? [], m.index.countries);
  if (!out.length) error(404, `no bundle named ${name}`);
  return out;
}

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

/* ----------------------------------------------------------------- bundles */

/** Bytes and zip index. Hashes are separate: only the bundle page shows them. */
function open(src: string) {
  return memo(`ipcc:${src}`, 30 * 60_000, async () => {
    let bytes: Uint8Array;
    if (src.startsWith("blob:")) {
      const obj = await bucket().get(`blobs/${src.slice(5)}.ipcc`);
      if (!obj) error(404, "bundle is not in the bucket");
      bytes = new Uint8Array(await obj.arrayBuffer());
    } else {
      bytes = await fetchApple(src);
    }
    return { opened: openIpcc(bytes), bytes, size: bytes.length };
  });
}

const digests = (src: string) =>
  memo(`digest:${src}`, 30 * 60_000, async () => {
    const b = await open(src);
    const [id, sha1, sha384] = await Promise.all([contentId(b.opened), sha1Hex(b.bytes), sha384Hex(b.bytes)]);
    return { id, sha1, sha384 };
  });

export async function getBundle(kind: Kind, name: string, slug?: string) {
  const { timeline, entry, previous } = await resolve(kind, name, slug);
  const [b, d] = await Promise.all([open(entry.src), digests(entry.src)]);
  const quick: Record<string, unknown> = {};
  for (const f of ["carrier.plist", "Info.plist", "version.plist"]) {
    if (b.opened.info.files.some((x) => x.path === f)) {
      try { quick[f] = decodeFile(b.opened, f).plist; } catch { /* shown as undecodable in Files */ }
    }
  }
  const { cc } = kind === "countries" ? { cc: undefined } : splitName(name);
  const plists = await countryPlists();
  const related = kind === "countries"
    ? { country: null, carriers: carriersOf(name, plists, (await getIndex()).carriers) }
    : { country: homeCountry(quick["carrier.plist"] as Record<string, unknown> | undefined, cc,
        new Set(Object.keys(plists)), isoIndex(plists)), carriers: [] };
  return {
    related,
    kind, name, cc, countryName: countryName(cc),
    entry: publicEntry(entry),
    previous: previous && publicEntry(previous),
    timeline: timeline.map(publicEntry),
    info: b.opened.info,
    downloadSize: b.size,
    contentId: d.id,
    sha1: d.sha1,
    sha384: d.sha384,
    // Image bundles are checked against their content id; OTA ones against the digest Apple publishes.
    verified: entry.id ? entry.id === d.id : entry.sha1 ? entry.sha1 === d.sha1 : entry.sha384 ? entry.sha384 === d.sha384 : null,
    quick,
  };
}

/** Timeline entry without the storage location, plus the Apple URL when there is one. */
function publicEntry(e: TimelineEntry) {
  const { src, ...rest } = e;
  return { ...rest, url: src.startsWith("blob:") ? null : src };
}
export type PublicEntry = ReturnType<typeof publicEntry>;

export async function getFile(kind: Kind, name: string, slug: string, path: string) {
  const { entry } = await resolve(kind, name, slug);
  const { opened } = await open(entry.src);
  try {
    return decodeFile(opened, path);
  } catch (e) {
    error(404, (e as Error).message);
  }
}

export async function getRaw(kind: Kind, name: string, slug: string, path: string) {
  const { entry } = await resolve(kind, name, slug);
  const b = await open(entry.src);
  const bytes = b.opened.entries[b.opened.prefix + path];
  if (!bytes) error(404, `no such file: ${path}`);
  return { bytes, opened: b.opened };
}

/* ----------------------------------------------------------------- compare */

export interface Side { kind: Kind; name: string; slug?: string }

/**
 * `b` against `a`, file by file; the one diff behind both /compare and a
 * version's Changes tab. Without `a`, `b` is compared to the version before it.
 * Content never changes under a src, so results are cached for a month.
 */
export async function getComparison(a: Side | null, b: Side, path?: string) {
  const rb = await resolve(b.kind, b.name, b.slug);
  const ra = a ? await resolve(a.kind, a.name, a.slug) : null;
  const left = ra ? { ...a!, entry: ra.entry } : rb.previous ? { ...b, entry: rb.previous } : null;
  const right = { ...b, entry: rb.entry };
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

const basebandKey = (build: string) => `system/${build}/baseband.json`;

/**
 * Written by the workflows, never here. baseband.yml can rewrite it after a
 * decoder change and purges the "baseband" page tag when it does; an isolate's
 * copy cannot be purged, so it is kept only an hour.
 */
const baseband = (build: string) =>
  memo(`baseband:${build}`, 3600_000, () => r2json<BasebandSummary>(basebandKey(build)));

async function mustBaseband(build: string) {
  const s = await baseband(build);
  if (!s) error(404, `No baseband summary for ${build} yet: it has not been extracted.`);
  return s;
}

/** Every image, and whether its baseband.json is there yet. */
export const basebandBuilds = async () => {
  const all = await builds();
  const has = await memo(`baseband:has:${all.map((b) => b.build).join(",")}`, 10 * 60_000, async () =>
    Object.fromEntries(await Promise.all(all.map(async (b) => [b.build, !!(await bucket().head(basebandKey(b.build)))] as const))));
  return all.map((b) => ({ build: b.build, version: b.version, has: has[b.build] }));
};

const where = (f: Pick<BasebandFile, "variants" | "configs">) =>
  f.configs?.length ? f.configs.join(", ") : (f.variants ?? []).map((v) => `${v.platform}/${v.sku}/${v.hwRev}`).join(" ");

/** MCC to country code, by the bundles the manifest routes each PLMN to. */
async function mccCountries(mccs: Iterable<string>) {
  const votes = new Map<string, Map<string, number>>();
  for (const e of (await getPlmn()).entries) {
    const cc = e.bundle && splitName(e.bundle).cc;
    if (!cc || e.mcc === "901") continue; // 901 is international: satellite, roaming SIMs
    const m = votes.get(e.mcc) ?? new Map<string, number>();
    m.set(cc, (m.get(cc) ?? 0) + 1);
    votes.set(e.mcc, m);
  }
  const out: Record<string, { cc: string; name?: string }> = {};
  for (const mcc of mccs) {
    const best = [...(votes.get(mcc) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) out[mcc] = { cc: best, name: countryName(best) };
  }
  return out;
}

/** The page's view of a package: everything but file contents and NV values. */
export async function getBaseband(build: string) {
  const [s, all] = await Promise.all([mustBaseband(build), builds()]);
  const mccs = new Set(s.amprNs.flatMap((a) => a.groups.flatMap((g) => g.mccs)));
  return {
    build,
    version: all.find((b) => b.build === build)?.version,
    package: s.package,
    members: s.members,
    // The header metadata is build-system placeholders apart from the version the page already names.
    containers: s.containers.map(({ meta: _meta, ...c }) => ({
      ...c,
      fileTypes: c.fileTypes.map((t) => ({ ...t, confidence: BBCFG_FILE_TYPES[t.type]?.confidence, note: BBCFG_FILE_TYPES[t.type]?.note })),
    })),
    files: s.files.map(({ text, hex: _h, ...f }, i) => ({ ...f, i, readable: text !== undefined })),
    nv: s.nv.map(({ records, ...n }) => ({
      ...n,
      records: records.map(({ nv, efs, hex, name, meaning, label, confidence }) => ({ nv, efs, hex, name, meaning, label, confidence })),
    })),
    images: s.images,
    bandCombos: s.bandCombos,
    amprNs: s.amprNs,
    mccs: await mccCountries(mccs).catch(() => ({}) as Awaited<ReturnType<typeof mccCountries>>),
    modemConfigs: s.modemConfigs ?? null,
    carrierMap: s.carrierMap ?? null,
  };
}

export async function getBasebandFile(build: string, i: number) {
  const f = (await mustBaseband(build)).files[i];
  if (!f) error(404, `no file ${i} in the ${build} baseband summary`);
  return { ...f, i };
}

/** One carrier's combo strings from one band_combos_per_plmn.xml variant. */
export async function getBasebandCombos(build: string, sha1: string, tag: string) {
  const f = (await mustBaseband(build)).files.find((x) => x.sha1 === sha1 && x.path.endsWith("/band_combos_per_plmn.xml"));
  if (!f?.text) error(404, `no band combo file ${sha1}`);
  const c = parseBandCombos(f.text).find((x) => x.tag === tag);
  if (!c) error(404, `no ${tag} in ${sha1}`);
  return c.combos;
}

/** A package flattened into keyed parts, so one diff lines them up by what they are. */
function basebandComparable(s: BasebandSummary) {
  const files: Record<string, unknown> = {};
  for (const f of s.files) files[`${f.member} ${f.path} [${where(f)}]`] = f.text !== undefined ? f.text.split("\n") : f.sha1;
  const combos: Record<string, unknown> = {};
  for (const set of s.bandCombos) {
    const text = s.files.find((f) => f.sha1 === set.sha1)?.text;
    const lists = text ? new Map(parseBandCombos(text).map((c) => [c.tag, c.combos])) : new Map<string, string[]>();
    const at = where(set);
    for (const { tag, ...stats } of set.carriers) combos[`${tag} [${at}]`] = { ...stats, list: [...(lists.get(tag) ?? [])].sort() };
  }
  return {
    Package: { package: s.package },
    "Band combos": combos,
    Carriers: s.carrierMap ?? {},
    Files: files,
    Power: Object.fromEntries(s.amprNs.map((a) => [`A-MPR NS [${where(a)}]`, a.groups])),
    "Modem configs": Object.fromEntries((s.modemConfigs ?? []).map((m) => [`${m.label ?? "@" + m.offset} ${m.cfgType}`, { version: m.version, trailer: m.trailer, files: m.files }])),
    Containers: Object.fromEntries(s.containers.map((c) => [c.member, { meta: c.meta, records: c.records, blobs: c.blobs, fileTypes: c.fileTypes }])),
  };
}

export interface BasebandDiffPart extends FileDiff { section: string }

/** `b` against `a`, part by part. Summaries never change under a build, so a pair is cached for a month. */
export async function getBasebandDiff(a: string, b: string) {
  const all = await builds();
  const side = (build: string) => ({ build, version: all.find((x) => x.build === build)?.version });
  return cached(`bbdiff:v1:${a}|${b}`, 30 * 86400, async () => {
    const [A, B] = await Promise.all([mustBaseband(a), mustBaseband(b)]);
    const ca = basebandComparable(A) as Record<string, Record<string, unknown>>;
    const cb = basebandComparable(B) as Record<string, Record<string, unknown>>;
    const parts: BasebandDiffPart[] = [];
    const MAX = 300;
    for (const section of Object.keys(cb)) {
      const x = ca[section] ?? {}, y = cb[section] ?? {};
      for (const path of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
        const kind: DiffKind = !(path in x) ? "added" : !(path in y) ? "removed" : "changed";
        const rows = kind === "changed" ? diffValues(x[path], y[path]) : [];
        if (kind === "changed" && !rows.length) continue;
        parts.push({ section, path, kind, rows: rows.slice(0, MAX), counts: summariseDiff(rows), truncated: rows.length > MAX });
      }
    }
    return { a: side(a), b: side(b), parts, counts: summariseDiff(parts.map((p) => ({ path: p.path, kind: p.kind }))) };
  });
}

/** The image a bundle version belongs to: its own for an image entry, the current release for OTA. */
async function bundleImage(kind: Kind, name: string, slug?: string) {
  const { entry } = await resolve(kind, name, slug);
  return { entry, build: entry.image ?? release(await builds())?.build };
}

/**
 * What the modem runs for this bundle before its own .der.pri lands: the
 * band-combo carrier tags whose PLMNs route here, and the package files each
 * .der.pri replaces by EFS path.
 */
export async function getBasebandDefaults(kind: Kind, name: string, slug?: string) {
  const { entry, build } = await bundleImage(kind, name, slug);
  const s = build ? await baseband(build) : null;
  if (!build || !s) return { build: build ?? null, missing: true as const };
  const tags = Object.entries(s.carrierMap ?? {})
    .filter(([, m]) => m.bundles.includes(name) || m.mvnoBundles.includes(name))
    .map(([tag, m]) => ({
      tag, plmns: m.plmns, primary: m.bundles.includes(name),
      // Platforms whose numbers match share one row.
      sets: s.bandCombos.reduce<Array<{ sha1: string; variants: Variant[]; key: string } & ComboStats>>((out, set) => {
        const c = set.carriers.find((x) => x.tag === tag);
        if (!c) return out;
        const { tag: _t, plmns: _p, ...stats } = c;
        const key = JSON.stringify(stats);
        const hit = out.find((o) => o.key === key);
        if (hit) hit.variants = [...hit.variants, ...set.variants].sort((a, b) => a.platform - b.platform || a.sku - b.sku);
        else out.push({ sha1: set.sha1, variants: [...set.variants], key, ...stats });
        return out;
      }, []),
    }));

  const { opened } = await open(entry.src);
  const byPath = new Map<string, Array<BasebandFile & { i: number }>>();
  s.files.forEach((f, i) => { if (f.text !== undefined) byPath.set(f.path, [...(byPath.get(f.path) ?? []), { ...f, i }]); });
  const overrides: Array<{ pri: string; efs: string; length: number; baseline: Array<{ i: number; member: string; variants?: Variant[]; configs?: string[]; same: boolean }> }> = [];
  let otherXml = 0;
  for (const file of opened.info.files) {
    if (file.kind !== "pri-der") continue;
    let pri;
    try { pri = decodeFile(opened, file.path).pri; } catch { continue; }
    for (const e of pri?.efs ?? []) {
      const text = e.value.xml ?? (e.value.kind === "string" ? e.value.text : undefined);
      if (text === undefined) continue;
      const base = byPath.get(e.path);
      if (!base) { if (e.value.xml) otherXml++; continue; }
      overrides.push({
        pri: file.path, efs: e.path, length: e.value.len,
        baseline: base.map((f) => ({ i: f.i, member: f.member, variants: f.variants, configs: f.configs, same: f.text === text })),
      });
    }
  }
  return { build, missing: false as const, version: (await builds()).find((b) => b.build === build)?.version, tags, overrides, otherXml };
}

/** A package file next to the .der.pri value that replaces it, with the lines that differ. */
export async function getBasebandOverride(kind: Kind, name: string, slug: string | undefined, pri: string, efs: string, i: number) {
  const { entry, build } = await bundleImage(kind, name, slug);
  const base = build ? (await mustBaseband(build)).files[i] : undefined;
  if (!base?.text || base.path !== efs) error(404, `no package file ${i} at ${efs}`);
  const { opened } = await open(entry.src);
  const v = decodeFile(opened, pri).pri?.efs.find((e) => e.path === efs)?.value;
  const text = v?.xml ?? v?.text;
  if (text === undefined) error(404, `${pri} does not set ${efs}`);
  const rows = diffValues(base.text.split("\n"), text.split("\n"));
  return { build, efs, pri, where: where(base), member: base.member, baseline: base.text, override: text, rows, counts: summariseDiff(rows) };
}

/* ------------------------------------------------------------ cross-cutting */

export async function getCbs() {
  const [m, all] = await Promise.all([manifest(), builds()]);
  const newest = release(all);
  return cached(`cbs:v2:${newest?.build ?? "ota"}:${m.fetchedAt.slice(0, 10)}`, 86400, async () => {
    const idx = newest && (await imageIndex(newest.build));
    const plists = newest && (await r2json<Record<string, Record<string, unknown>>>(`system/${newest.build}/countries.json`));
    const image = idx && plists
      ? { version: idx.version, build: idx.build, plists,
          builds: Object.fromEntries(Object.entries(idx.countries).map(([k, v]) => [k, v.build])) }
      : null;
    return buildMergedCbsMatrix(image, m.index.countries, fetchApple);
  });
}

export const getPlmn = async () => (await manifest()).plmn;

/* -------------------------------------------------------------------- scan */

/** Which scan index generation to read. Written by the workflow, never here. */
const scanPointer = () =>
  memo("scan:pointer", 10 * 60_000, async () => ({ p: await r2json<ScanPointer>(POINTER_KEY) })).then((x) => x.p);

/** Every src the generation indexed, so "lacks the file" can be told from "not indexed". */
const scanBundles = (gen: string) =>
  memo(`scan:bundles:${gen}`, 3600_000, async () => new Set((await r2json<{ srcs: string[] }>(bundlesKey(gen)))?.srcs ?? []));

const scanFileIndex = (gen: string, file: string) =>
  memo(`scan:idx:${gen}|${file}`, 3600_000, async () => ({ i: await r2json<ScanFileIndex>(fileIndexKey(gen, file)) }))
    .then((x) => x.i);

/** One shard, by range read out of the file's packed data object. */
const scanShard = (gen: string, file: string, top: string, [offset, length]: [number, number]) =>
  memo(`scan:shard:${gen}|${file}|${top}`, 3600_000, async () => {
    const obj = await bucket().get(fileDataKey(gen, file), { range: { offset, length } });
    return obj ? (await obj.json<ScanShard>()) : null;
  });

/** Head bundle of every carrier (or country) in scope, in parallel. */
async function scanTargets(scope: string): Promise<{ kind: Kind; targets: ScanTarget[] }> {
  const idx = await getIndex();
  const kind: Kind = scope === "countries" ? "countries" : "carriers";
  const cc = scope.startsWith("country:") ? scope.slice(8) : null;
  const names = idx[kind].filter((e) => !cc || e.cc === cc);
  const targets = await Promise.all(names.map(async (e): Promise<ScanTarget | null> => {
    const t = await getTimeline(kind, e.name).catch(() => null);
    const head = t?.[headIndex(t)];
    return head ? { name: e.name, display: e.display, cc: e.cc, os: head.ios.at(-1) ?? "", build: head.build, src: head.src } : null;
  }));
  return { kind, targets: targets.filter((t): t is ScanTarget => !!t) };
}

/**
 * Every bundle in scope's value at `path` in `file`. `path` may use `[*]` for
 * any index and `*` for any key. Covers the whole scope: no limit.
 */
export async function scanKey(path: string, file: string, scope: string) {
  const [{ targets }, pointer] = await Promise.all([scanTargets(scope), scanPointer()]);
  const top = topKey(path);
  const key = `scan:v3:${pointer?.gen ?? "none"}|${scope}|${file}|${path}|${fingerprint(targets.map((t) => t.src))}`;
  return cached(key, 86400, async () => {
    const rows: TargetRow[] = targets.map(() => undefined);
    if (pointer) {
      const [indexed, fi] = await Promise.all([scanBundles(pointer.gen), scanFileIndex(pointer.gen, file)]);
      const bySrc = new Map(targets.map((t, i) => [t.src, i]));
      targets.forEach((t, i) => { if (indexed.has(t.src)) rows[i] = null; });
      for (const src of fi?.srcs ?? []) { const i = bySrc.get(src); if (i !== undefined) rows[i] = {}; }
      const loc = fi?.shards[top];
      const shard = loc && (await scanShard(pointer.gen, file, top, loc));
      shard?.at.forEach((at, k) => { const i = bySrc.get(fi!.srcs[at]); if (i !== undefined) rows[i] = shard.rows[k]; });
    }
    return keyScan(targets, rows, file, path, scope);
  });
}

/** FNV-1a over the target set: a new head bundle anywhere means a new scan. */
function fingerprint(xs: string[]): string {
  let h = 0x811c9dc5;
  for (const x of xs) for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + xs.length;
}


/** A country search guessed from where the request came from. */
export async function guessCountry(): Promise<string | null> {
  const { platform, locals } = getRequestEvent();
  // Same bargain as the carrier guess: this is the visitor's own location.
  locals.perVisitor = true;
  const cc = platform?.cf?.country?.toLowerCase();
  if (!cc) return null;
  const { countries } = await getIndex();
  const hit = isoIndex(await countryPlists()).get(cc);
  if (hit && countries.some((c) => c.name === hit)) return hit;
  // Territories and, without countries.json, everything else: Apple's bundle
  // names are the English name with the spaces taken out. Accents are folded
  // rather than dropped, or Réunion would not reach Reunion.
  const flat = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
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
