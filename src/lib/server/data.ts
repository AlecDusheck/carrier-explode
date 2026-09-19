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
import { contentId, decodeFile, openIpcc, type OpenedBundle } from "./ipcc";
import { buildMergedCbsMatrix } from "./cbs";
import { diffValues, summariseDiff } from "./diff";
import { guessCarrierQuery } from "./guess";
import { keyScan, type ScanTarget } from "./keyscan";
import { carriersOf, homeCountry, isoIndex, type CountryPlists } from "./related";
import { buildTimeline, type ImageBuild, type ImageIndex, type TimelineEntry } from "./timeline";

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
  memo("builds", 5 * 60_000, async () => {
    const list = await r2json<ImageBuild[]>("system/builds.json");
    return list?.length ? list : null;
  }).then((b) => b ?? []);

/** An image's index never changes once written. */
const imageIndex = (build: string) =>
  memo(`image:${build}`, 24 * 3600_000, () => r2json<ImageIndex>(`system/${build}/index.json`));

async function imageIndexes(): Promise<ImageIndex[]> {
  const all = await Promise.all((await builds()).map((b) => imageIndex(b.build)));
  return all.filter((x): x is ImageIndex => !!x);
}

/** Every country carrier.plist from the newest image, decoded. */
const countryPlists = async () => {
  const newest = (await builds())[0];
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
  /** Bundle build inside the newest image, when it ships there. */
  image?: string;
  /** Distinct OTA builds published. */
  ota: number;
}

export async function getIndex() {
  const [m, images] = await Promise.all([manifest(), imageIndexes()]);
  const newest = images[0];

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
    builds: await builds(),
    manifestFetchedAt: m.fetchedAt,
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
    ? timeline.findIndex((e) => e.slug === slug || (e.source === "image" && e.ios.some((v) => `ios-${v}` === slug)))
    : 0;
  if (i < 0) error(404, `${name} has no version ${slug}`);
  // "Previous" skips per-model variants unless we are on one.
  const entry = timeline[i];
  const previous = timeline.slice(i + 1).find((e) => e.productType === entry.productType) ?? null;
  return { timeline, entry, previous };
}

/* ----------------------------------------------------------------- bundles */

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
    const opened = openIpcc(bytes);
    return { opened, bytes, size: bytes.length, id: await contentId(opened), sha1: await sha1Hex(bytes), sha384: await sha384Hex(bytes) };
  });
}

export async function getBundle(kind: Kind, name: string, slug?: string) {
  const { timeline, entry, previous } = await resolve(kind, name, slug);
  const b = await open(entry.src);
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
    contentId: b.id,
    sha1: b.sha1,
    sha384: b.sha384,
    // Image bundles are checked against their content id; OTA ones against the digest Apple publishes.
    verified: entry.id ? entry.id === b.id : entry.sha1 ? entry.sha1 === b.sha1 : entry.sha384 ? entry.sha384 === b.sha384 : null,
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

/* ----------------------------------------------------------------- changes */

async function memberHashes(o: OpenedBundle): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const f of o.info.files) out.set(f.path, await sha1Hex(o.entries[o.prefix + f.path]));
  return out;
}

const decoded = (o: OpenedBundle, path: string) => {
  try {
    const d = decodeFile(o, path);
    return d.plist ?? d.pri ?? d.text ?? null;
  } catch {
    return null;
  }
};

/** What changed between a version and the one before it, file by file. */
export async function getChanges(kind: Kind, name: string, slug: string) {
  const { entry, previous } = await resolve(kind, name, slug);
  if (!previous) return { entry: publicEntry(entry), previous: null, files: [] };
  return cached(`changes:v1:${entry.src}|${previous.src}`, 30 * 86400, async () => {
    const [now, before] = await Promise.all([open(entry.src), open(previous.src)]);
    const [h1, h0] = await Promise.all([memberHashes(now.opened), memberHashes(before.opened)]);
    const files = [];
    for (const path of [...new Set([...h1.keys(), ...h0.keys()])].sort()) {
      const kindOf = !h0.has(path) ? "added" : !h1.has(path) ? "removed" : h0.get(path) !== h1.get(path) ? "changed" : null;
      if (!kindOf) continue;
      const rows = kindOf === "changed" ? diffValues(decoded(before.opened, path), decoded(now.opened, path)) : [];
      files.push({ path, kind: kindOf, rows: rows.slice(0, 400), truncated: rows.length > 400 });
    }
    return { entry: publicEntry(entry), previous: publicEntry(previous), files };
  });
}

export async function getDiff(a: { kind: Kind; name: string; slug?: string }, b: typeof a, path: string) {
  const [ra, rb] = await Promise.all([resolve(a.kind, a.name, a.slug), resolve(b.kind, b.name, b.slug)]);
  const [A, B] = await Promise.all([open(ra.entry.src), open(rb.entry.src)]);
  const rows = diffValues(decoded(A.opened, path), decoded(B.opened, path));
  const bFiles = new Set(B.opened.info.files.map((f) => f.path));
  return {
    rows: rows.slice(0, 1000),
    counts: summariseDiff(rows),
    shared: A.opened.info.files.map((f) => f.path).filter((p) => bFiles.has(p)),
  };
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

/* ------------------------------------------------------------ cross-cutting */

export async function getCbs() {
  const [m, all] = await Promise.all([manifest(), builds()]);
  const newest = all[0];
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

export async function scanKey(path: string, file: string, scope: string, limit: number) {
  const idx = await getIndex();
  const kind: Kind = scope === "countries" ? "countries" : "carriers";
  const cc = scope.startsWith("country:") ? scope.slice(8) : null;
  const names = idx[kind].filter((e) => !cc || e.cc === cc);
  // Bundles that ship in the current image first: those are the live ones.
  names.sort((a, b) => Number(!!b.image) - Number(!!a.image) || a.name.localeCompare(b.name));
  return cached(`scan:v2:${scope}|${file}|${path}|${limit}|${idx.builds[0]?.build}`, 7 * 86400, async () => {
    const targets: ScanTarget[] = [];
    for (const e of names.slice(0, limit)) {
      const head = (await getTimeline(kind, e.name)).find((t) => !t.productType);
      if (head) targets.push({ name: e.name, display: e.display, cc: e.cc, ref: { os: head.ios.at(-1) ?? "", build: head.build, url: head.src } });
    }
    const result = await keyScan(targets, file, path, async (src) => (await open(src)).bytes, scope, limit);
    return { ...result, candidates: names.length, truncated: names.length > limit,
      hits: result.hits.map(({ url: _url, ...h }) => h) };
  });
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
