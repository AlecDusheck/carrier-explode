/**
 * iOS native views: a carrier, Watch or country bundle at one version, opened
 * and decoded file by file. The bytes are obj/<sha> when the extractor holds
 * them; an OTA file it has not archived yet comes straight from Apple.
 *
 * Every function takes a version as its URL names it (catalog.ts Ver): a
 * source key (`ios:carrier:ATT_US`), a line for a model-specific bundle, and a
 * version; no version means the head.
 */

import { error } from "@sveltejs/kit";
import {
  byNewest, carriedBy, comparable, compareBundles, contentId, decodeFile, decodedPlist, decodedPri, diffValues, isJsonDict,
  mergeComboSets, openIpcc, priReplacements, priText, summariseDiff,
  type BundleDiff, type BundleFile, type BundleInfo, type ComboSetRow, type DecodedFile, type DiffCounts, type DiffRow,
  type OpenedBundle, type PriDecoded, type PriReplacement,
} from "#lib/decode/index.ts";
import { sha1Hex, sha256Hex } from "#lib/binary/index.ts";
import { keys } from "#lib/storage/keys.ts";
import { decoderFamily, sourceKey, type Platform, type SourceRef, type TimelineEntry } from "#lib/schema/types.ts";
import { countryName, splitName } from "#lib/names.ts";
import { homePhone, isPri, knowsPhone, overridesFor, sharedPri, type GroupPhone, type PhoneRow } from "#lib/phones.ts";
import type { CbsRow, Version } from "#lib/types.ts";
import { bbfwSummary } from "./baseband";
import { cached, fetchApple, perRequest } from "./cache";
import { archivedSha, currentRelease, releaseList, resolve, isIndexed, versionOf, type Resolved, type Ver } from "./catalog";
import { cbsRow } from "./cbs";
import { modemView } from "./modems";
import type { ImageModem } from "#lib/schema/types.ts";
import { releaseModems } from "./releases";
import { readBytes } from "./store";

/** Content never changes under a sha or an Apple URL, so what is derived from one is kept for a month. */
const KEEP = 30 * 86400;

/** An OTA copy not archived yet: the bytes come from Apple. */
const pending = (e: TimelineEntry): string | undefined =>
  e.copies.flatMap((c) => (c.via === "ota" && c.archive.state !== "archived" ? [c.url] : []))[0];

/** What a version's derived views are cached by. Content never changes under a sha or an Apple URL. */
const identity = (e: TimelineEntry): string => archivedSha(e) ?? pending(e) ?? e.slug;

async function bytesOf(e: TimelineEntry): Promise<Uint8Array<ArrayBuffer>> {
  const sha = archivedSha(e);
  if (sha !== undefined) {
    const held = await readBytes(keys.obj(sha));
    if (!held) error(500, `obj/${sha} is indexed but missing from the bucket.`);
    return held;
  }
  const url = pending(e);
  if (url === undefined) error(404, `Version ${e.slug} has no copy to read.`);
  return fetchApple(url);
}

/** Bytes from the bucket match by content id or sha; Apple's by the digest it publishes (SHA-1 only: #lib/binary has no SHA-384). */
function verify(e: TimelineEntry, got: { cid: string; sha256: string; sha1: string }): boolean | null {
  const checks = e.copies.flatMap((c): boolean[] => {
    if (c.via === "image") return [c.cid !== undefined ? c.cid === got.cid : c.sha === got.sha256];
    if (c.archive.state === "archived") return [c.archive.cid === got.cid];
    return c.digest?.algorithm === "sha1" ? [c.digest.hex === got.sha1] : [];
  });
  return checks.length ? checks.some(Boolean) : null;
}

interface Opened extends Resolved {
  readonly opened: OpenedBundle;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/** A version's bytes and zip index. Several queries of one page read the same bundle, so it is opened once per request. */
const openOnce = perRequest(async (source: string, line: string, slug: string): Promise<Opened> => {
  const r = await resolve({ source, line: line || undefined, slug: slug || undefined });
  if (decoderFamily(r.ref.platform) !== "apple") error(400, `${source} is not an Apple bundle.`);
  const bytes = await bytesOf(r.entry);
  return { ...r, opened: openIpcc(bytes), bytes };
});
const open = (v: Ver): Promise<Opened> => openOnce(v.source, v.line ?? "", v.slug ?? "");

/** A decoded .der.pri, or undefined when the file is not one: callers skip what does not decode, as the phone would. */
function readPri(opened: OpenedBundle, path: string): PriDecoded | undefined {
  try {
    return decodedPri(decodeFile(opened, path));
  } catch {
    return undefined;
  }
}

/** A member plist as a dictionary, or undefined when it is absent or not one. */
function plistOf(opened: OpenedBundle, path: string): Record<string, unknown> | undefined {
  if (!opened.info.files.some((f) => f.path === path)) return undefined;
  try {
    const v = decodedPlist(decodeFile(opened, path));
    return isJsonDict(v) ? v : undefined;
  } catch {
    // Shown as undecodable in Files, with the reason; here it is only absent.
    return undefined;
  }
}

/** A carrier bundle's home country bundle, by HomeBundleIdentifier ("com.apple.UnitedStates"), when the index has it. */
async function homeCountry(platform: Platform, carrier: Record<string, unknown> | undefined): Promise<string | null> {
  const home = carrier?.HomeBundleIdentifier;
  if (typeof home !== "string") return null;
  const name = home.replace(/^com\.apple\./, "");
  const key = sourceKey({ platform, kind: "country", name });
  return (await isIndexed(key)) ? key : null;
}

export interface IosBundle {
  readonly source: string;
  readonly ref: SourceRef;
  readonly cc: string | undefined;
  readonly countryName: string | undefined;
  readonly line: string | undefined;
  readonly entry: Version;
  readonly previous: Version | null;
  readonly info: BundleInfo;
  readonly downloadSize: number;
  readonly contentId: string;
  readonly sha256: string;
  readonly sha1: string;
  /** Whether the bytes are what the index or Apple says they are; null when nothing says. */
  readonly verified: boolean | null;
  /** carrier.plist, Info.plist and version.plist, decoded: what the Overview and Settings read. */
  readonly quick: Readonly<Record<string, unknown>>;
  /** The home country bundle's source key, for a carrier bundle that names one. */
  readonly home: string | null;
}

export async function getBundle(v: Ver): Promise<IosBundle> {
  const o = await open(v);
  const { entry, opened, bytes } = o;
  const [id, sha256, current, previous] = await Promise.all([
    contentId(opened), sha256Hex(bytes), versionOf(o.ref.platform, entry), o.previous ? versionOf(o.ref.platform, o.previous) : null,
  ]);
  const sha1 = sha1Hex(bytes);
  const quick: Record<string, unknown> = {};
  for (const f of ["carrier.plist", "Info.plist", "version.plist"]) {
    const p = plistOf(opened, f);
    if (p) quick[f] = p;
  }
  const cc = o.doc.carrier.iso ?? splitName(o.ref.name).cc;
  const verified = verify(entry, { cid: id, sha256, sha1 });
  return {
    source: o.key, ref: o.ref, cc, countryName: countryName(cc), line: o.line,
    entry: current,
    previous,
    info: opened.info,
    downloadSize: bytes.length,
    contentId: id, sha256, sha1, verified, quick,
    home: o.ref.kind === "carrier" ? await homeCountry(o.ref.platform, plistOf(opened, "carrier.plist")) : null,
  };
}

export async function getFile(v: Ver, path: string): Promise<DecodedFile> {
  const { opened } = await open(v);
  try {
    return decodeFile(opened, path);
  } catch (e) {
    error(404, e instanceof Error ? e.message : String(e));
  }
}

export async function getRaw(v: Ver, path: string): Promise<Uint8Array> {
  const { opened } = await open(v);
  const bytes = opened.entries[opened.prefix + path];
  if (!bytes) error(404, `no such file: ${path}`);
  return bytes;
}

/** A country bundle's emergency alert settings at this version. */
export async function getAlerts(v: Ver): Promise<CbsRow | null> {
  const { opened } = await open(v);
  const plist = plistOf(opened, "carrier.plist");
  const locales = opened.info.files.filter((f) => f.path.endsWith("CBMessage.strings")).flatMap((f) => f.locale ?? []);
  return plist ? cbsRow(plist, locales) : null;
}

/* ----------------------------------------------------------------- compare */

export interface ComparedSide {
  readonly source: string;
  readonly ref: SourceRef;
  readonly entry: Version;
}

export interface NativeComparison {
  readonly a: ComparedSide | null;
  readonly b: ComparedSide;
  readonly diff: BundleDiff | null;
}

/**
 * `b` against `a`, file by file; the one diff behind /compare and a version's
 * Changes tab. Without `a`, `b` is compared to the version before it.
 */
export async function getComparison(a: Ver | null, b: Ver, path?: string): Promise<NativeComparison> {
  const [rb, ra] = await Promise.all([resolve(b), a ? resolve(a) : null]);
  const left = ra ? { r: ra, entry: ra.entry } : rb.previous ? { r: rb, entry: rb.previous } : null;
  const side = async (r: Resolved, entry: TimelineEntry): Promise<ComparedSide> =>
    ({ source: r.key, ref: r.ref, entry: await versionOf(r.ref.platform, entry) });
  const right = await side(rb, rb.entry);
  if (!left) return { a: null, b: right, diff: null };
  const leftSide = await side(left.r, left.entry);
  const diff = await cached(`compare:v2:${identity(left.entry)}|${identity(rb.entry)}|${path ?? ""}`, KEEP, async () => {
    const [A, B] = await Promise.all([
      open({ source: leftSide.source, line: left.r.line, slug: left.entry.slug }),
      open({ source: right.source, line: rb.line, slug: rb.entry.slug }),
    ]);
    return compareBundles(A.opened, B.opened, { ...(path ? { path } : {}), maxRows: path ? 2000 : 400 });
  });
  return { a: leftSide, b: right, diff };
}

/* ------------------------------------------------------------------ phones */

type PhoneFile = Pick<BundleFile, "path" | "kind" | "devices">;
type ReleasePhone = GroupPhone & { readonly family: string };

/** The release a version is read against: the newest image carrying it, else (an OTA file) the platform's current release. */
async function releaseOf(platform: Platform, entry: TimelineEntry): Promise<string | null> {
  const carrying = new Set(entry.copies.flatMap((c) => (c.via === "image" ? c.releases : [])));
  const newest = (await releaseList()).find((r) => r.platform === platform && carrying.has(r.id));
  return newest?.id ?? (await currentRelease(platform))?.id ?? null;
}

interface PhoneCopies {
  readonly entry: TimelineEntry;
  readonly build: string;
  readonly devices: readonly string[];
  readonly modems: readonly ImageModem[];
  readonly phones: readonly ReleasePhone[];
  readonly copies: ReadonlyArray<{ readonly files: readonly PhoneFile[]; readonly known: boolean }>;
}

/**
 * Every phone of a version's release, newest family first, with its modem override files in that
 * version. A phone without any is `known` when the version was made while it existed (so it has none
 * and runs the defaults); otherwise the version is older than the phone.
 */
const phoneCopiesOnce = perRequest(async (source: string, line: string, slug: string): Promise<PhoneCopies | null> => {
  const { entry, opened, ref } = await open({ source, line: line || undefined, slug: slug || undefined });
  const build = await releaseOf(ref.platform, entry);
  if (!build) return null;
  const { release, modems } = await releaseModems(build);
  const phones = byNewest(modems.map(modemView)).flatMap((m) => m.devices.map((d) => ({ ...d, family: m.family })));
  const files = opened.info.files;
  const copies = phones.map((p) => {
    const mine = overridesFor(files, p.id).map(({ path, kind, devices }): PhoneFile => ({ path, kind, ...(devices ? { devices } : {}) }));
    return { files: mine, known: mine.length > 0 || knowsPhone(files, p.id) };
  });
  return { entry, build, devices: release.devices, modems, phones, copies };
});
const phoneCopies = (v: Ver): Promise<PhoneCopies | null> => phoneCopiesOnce(v.source, v.line ?? "", v.slug ?? "");

export interface BundleOverrides {
  readonly build: string;
  /** The phone the version means. */
  readonly home: string | undefined;
  readonly files: readonly PhoneRow[];
  /** Phones with no override file in a version made while they existed: they run the modem's defaults. */
  readonly defaults: readonly ReleasePhone[];
  /** Phones newer than the version. */
  readonly unknown: readonly ReleasePhone[];
}

/** A version's modem override files, each with the phones that read it, and the phones left over. */
export async function getBundleOverrides(at: Ver): Promise<BundleOverrides | null> {
  const v = await phoneCopies(at);
  if (!v) return null;
  const files = new Map<string, { slug: string; path: string; phones: ReleasePhone[] }>();
  const defaults: ReleasePhone[] = [], unknown: ReleasePhone[] = [];
  v.phones.forEach((p, i) => {
    const c = v.copies[i];
    if (!c?.files.length) {
      (c?.known ? defaults : unknown).push(p);
      return;
    }
    for (const f of c.files) {
      const row = files.get(f.path) ?? { slug: v.entry.slug, path: f.path, phones: [] };
      row.phones.push(p);
      files.set(f.path, row);
    }
  });
  return { build: v.build, home: homePhone(at.line ? [at.line] : v.devices), files: [...files.values()], defaults, unknown };
}

/** One override file of a phone group, against what that phone had before. */
export interface PhoneFileChange {
  /** The file in this version, and in the copy compared against. */
  readonly path: string;
  readonly before?: string | undefined;
  readonly kind: "same" | "changed" | "added" | "removed";
  readonly counts: DiffCounts;
  readonly rows: readonly DiffRow[];
  readonly truncated: boolean;
}

export interface PhoneChange {
  readonly phones: readonly ReleasePhone[];
  /**
   * "compared": the version compared against has files for these phones. "new": it was made while the phone
   * existed and gave it none (carrier.plist alone). "unknown": it is older than the phone.
   */
  readonly status: "compared" | "new" | "unknown";
  readonly plist?: PhoneFileChange | undefined;
  readonly modem?: PhoneFileChange | undefined;
}

const PHONE_ROWS = 300;
const isPhonePlist = (f: Pick<BundleFile, "path">): boolean => /^overrides_.+\.plist$/.test(f.path);

function fileChange(A: OpenedBundle | null, before: string | undefined, B: OpenedBundle, path: string | undefined): PhoneFileChange | undefined {
  const value = (o: OpenedBundle, p: string): unknown => {
    try {
      return comparable(decodeFile(o, p));
    } catch {
      // A member that does not decode compares as absent; Files shows why.
      return null;
    }
  };
  const none = { counts: summariseDiff([]), rows: [], truncated: false };
  if (!path) return before ? { path: before, before, kind: "removed", ...none } : undefined;
  if (!A || !before) return { path, kind: "added", ...none };
  const rows = diffValues(value(A, before), value(B, path));
  return { path, before, kind: rows.length ? "changed" : "same", counts: summariseDiff(rows), rows: rows.slice(0, PHONE_ROWS), truncated: rows.length > PHONE_ROWS };
}

/**
 * A version's phone groups, each one's override plist and modem file against what that phone had at the
 * version compared against. Comparing the two copies file by file would show a phone moving to another
 * group's file as one file removed and another added; this compares per phone.
 */
export async function getPhoneChanges(v: Ver, against?: string): Promise<PhoneChange[] | null> {
  const { entry: b, previous } = await resolve(v);
  const a = against ? (await resolve({ ...v, slug: against })).entry : previous;
  const vb = await phoneCopies(v);
  if (!a || !vb) return null;
  return cached(`phonechanges:v4:${identity(b)}|${identity(a)}|${vb.phones.map((p) => p.id).join(",")}`, KEEP, async () => {
    const [{ opened: A }, { opened: B }] = await Promise.all([open({ ...v, slug: a.slug }), open(v)]);
    /** A phone's override files in a copy: its plist and its modem file, by the boards in their names. */
    const filesFor = (o: OpenedBundle, phone: string): BundleFile[] => o.info.files.filter((f) => f.devices?.some((d) => d.ids === phone));
    // Phone groups as this version files them: phones that read the same files.
    const groups = new Map<string, { files: BundleFile[]; phones: ReleasePhone[] }>();
    for (const p of vb.phones) {
      const files = filesFor(B, p.id);
      if (!files.length) continue;
      const k = files.map((f) => f.path).sort().join("|");
      const g = groups.get(k) ?? { files, phones: [] };
      g.phones.push(p);
      groups.set(k, g);
    }
    return [...groups.values()].flatMap(({ files, phones }): PhoneChange[] => {
      const phone = phones[0]?.id;
      if (!phone) return [];
      const before = filesFor(A, phone);
      const known = before.length > 0 || knowsPhone(A.info.files, phone);
      const had = before.length ? A : null;
      return [{
        phones,
        status: before.length ? "compared" : known ? "new" : "unknown",
        plist: fileChange(had, before.find(isPhonePlist)?.path, B, files.find(isPhonePlist)?.path),
        modem: fileChange(had, before.find(isPri)?.path, B, files.find(isPri)?.path),
      }];
    });
  });
}

export interface OverridePlist {
  readonly path: string;
  readonly plist: Readonly<Record<string, unknown>>;
}

/** A phone's override plist next to its modem file (same stem), decoded; null when the copy has none. */
export async function getOverridePlist(v: Ver, priPath: string): Promise<OverridePlist | null> {
  const path = priPath.replace(/(\.der)?\.pri$/, ".plist");
  const plist = plistOf((await open(v)).opened, path);
  return plist ? { path, plist } : null;
}

/* ---------------------------------------------------------------- baseband */

export interface ComboTag {
  readonly tag: string;
  readonly plmns: readonly string[];
  readonly primary: boolean;
  readonly sets: readonly ComboSetRow[];
}

export type ModemDefaults =
  | { readonly missing: true; readonly build: string | null }
  | {
    readonly missing: false;
    readonly build: string;
    readonly version: string;
    readonly family: string;
    readonly id: string;
    readonly phone: string;
    readonly tags: readonly ComboTag[];
    readonly overrides: ReadonlyArray<{ readonly pri: string } & PriReplacement>;
    readonly otherXml: number;
    /** The version the .der.pri files were read from, for getBasebandOverride. */
    readonly slug: string;
  };

/**
 * What the modem of `device` runs for this bundle before the bundle's own
 * .der.pri lands: the band-combo carrier tags whose PLMNs route here, and the
 * package files that phone's .der.pri replaces by EFS path. Without `device`,
 * the version's home phone.
 */
export async function getBasebandDefaults(at: Ver, device?: string): Promise<ModemDefaults> {
  const v = await phoneCopies(at);
  if (!v) return { missing: true, build: null };
  const phone = device ?? homePhone(at.line ? [at.line] : v.devices);
  const m = phone ? v.modems.find((x) => x.devices.includes(phone) && x.package.kind === "bbfw") : undefined;
  const [{ opened, ref }, s] = await Promise.all([open(at), m ? bbfwSummary(m.package.sha) : null]);
  if (!phone || !m || !s) return { missing: true, build: v.build };

  const name = ref.name;
  const tags = Object.entries(s.carrierMap ?? {})
    .filter(([, c]) => c.bundles.includes(name) || c.mvnoBundles.includes(name))
    .map(([tag, c]): ComboTag => ({ tag, plmns: c.plmns, primary: c.bundles.includes(name), sets: mergeComboSets(s.bandCombos, tag) }));

  const own = new Set([...overridesFor(opened.info.files, phone), ...sharedPri(opened.info.files)].map((f) => f.path));
  const overrides: Array<{ pri: string } & PriReplacement> = [];
  let otherXml = 0;
  for (const file of opened.info.files) {
    const pri = file.kind === "pri-der" && own.has(file.path) ? readPri(opened, file.path) : undefined;
    if (!pri) continue;
    const r = priReplacements(pri, s);
    overrides.push(...r.replaced.map((x) => ({ pri: file.path, ...x })));
    otherXml += r.otherXml;
  }
  const { release } = await releaseModems(v.build);
  return {
    missing: false, build: v.build, version: release.version, family: m.family, id: m.package.sha, phone, tags, overrides, otherXml,
    slug: v.entry.slug,
  };
}

export interface ModemOverride {
  readonly id: string;
  readonly efs: string;
  readonly pri: string;
  readonly where: string;
  readonly member: string;
  readonly baseline: string;
  readonly override: string;
  readonly rows: readonly DiffRow[];
  readonly counts: DiffCounts;
}

/** File `i` of modem package `id` next to the .der.pri value that replaces it, with the lines that differ. */
export async function getBasebandOverride(v: Ver, id: string, pri: string, efs: string, i: number): Promise<ModemOverride> {
  const [{ opened }, s] = await Promise.all([open(v), bbfwSummary(id)]);
  const base = s?.files[i];
  if (!base?.text || base.path !== efs) error(404, `no package file ${i} at ${efs}`);
  const value = readPri(opened, pri)?.efs.find((e) => e.path === efs)?.value;
  const text = value && priText(value);
  if (text === undefined) error(404, `${pri} does not set ${efs}`);
  const rows = diffValues(base.text.split("\n"), text.split("\n"));
  return { id, efs, pri, where: carriedBy(base), member: base.member, baseline: base.text, override: text, rows, counts: summariseDiff(rows) };
}
