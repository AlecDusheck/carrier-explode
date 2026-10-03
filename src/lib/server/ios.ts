/**
 * iOS native views: a carrier, Watch or country bundle at one version, opened
 * and decoded file by file. The bytes are obj/<sha> when the extractor holds
 * them; an OTA file it has not archived yet comes straight from Apple.
 *
 * Every function takes a source key (`ios:carrier:ATT_US`) and a timeline slug;
 * no slug means the head version.
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
import { sourceKey, type SourceRef, type TimelineEntry } from "#lib/schema/types.ts";
import { countryName, splitName } from "#lib/names.ts";
import { homePhone, isPri, knowsPhone, overridesFor, sharedPri, type GroupPhone, type PhoneRow } from "#lib/phones.ts";
import type { CbsRow, Place, Version } from "#lib/types.ts";
import { bbfwSummary } from "./baseband";
import { cached, fetchApple, perRequest } from "./cache";
import { currentRelease, placeOf, releaseList, resolve, sourceSlugs, versionsOf, type Resolved } from "./catalog";
import { cbsRow } from "./cbs";
import { modemView } from "./modems";
import type { ImageModem } from "./records";
import { releaseModems } from "./releases";
import { readBytes } from "./store";

/** Content never changes under a sha or an Apple URL, so what is derived from one is kept for a month. */
const KEEP = 30 * 86400;

/** What a version's bytes are cached and diffed by: its object, else its Apple URL. */
const identity = (e: TimelineEntry): string => e.sha ?? e.url ?? e.slug;

async function bytesOf(e: TimelineEntry): Promise<Uint8Array<ArrayBuffer>> {
  if (e.sha) {
    const held = await readBytes(keys.obj(e.sha));
    if (held) return held;
  }
  if (e.url) return fetchApple(e.url);
  error(404, `Version ${e.slug} is neither in the bucket nor published by Apple.`);
}

interface Opened extends Resolved {
  readonly opened: OpenedBundle;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/** A version's bytes and zip index. Several queries of one page read the same bundle, so it is opened once per request. `slug` "" is the head. */
const open = perRequest(async (key: string, slug: string): Promise<Opened> => {
  const r = await resolve(key, slug || undefined);
  if (r.ref.platform !== "ios") error(400, `${key} is not an iOS bundle.`);
  const bytes = await bytesOf(r.entry);
  return { ...r, opened: openIpcc(bytes), bytes };
});

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
async function homeCountry(carrier: Record<string, unknown> | undefined): Promise<string | null> {
  const home = carrier?.HomeBundleIdentifier;
  if (typeof home !== "string") return null;
  const key = sourceKey({ platform: "ios", kind: "country", name: home.replace(/^com\.apple\./, "") });
  return key in (await sourceSlugs()) ? key : null;
}

async function ccOf(r: Resolved, place: Place | null): Promise<string | undefined> {
  if (r.ref.kind === "country") return place?.id;
  return r.doc.carrier.iso ?? splitName(r.ref.name).cc;
}

export interface IosBundle {
  readonly source: string;
  readonly ref: SourceRef;
  readonly place: Place | null;
  readonly cc: string | undefined;
  readonly countryName: string | undefined;
  readonly entry: Version;
  readonly previous: Version | null;
  readonly timeline: readonly Version[];
  /** The version phones on a release run: the newest plain, non-beta copy. */
  readonly head: string;
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

export async function getBundle(key: string, slug?: string): Promise<IosBundle> {
  const o = await open(key, slug ?? "");
  const { entry, opened, bytes } = o;
  const [place, id, sha256, timeline] = await Promise.all([placeOf(key), contentId(opened), sha256Hex(bytes), versionsOf("ios", o.timeline)]);
  const sha1 = sha1Hex(bytes);
  const quick: Record<string, unknown> = {};
  for (const f of ["carrier.plist", "Info.plist", "version.plist"]) {
    const p = plistOf(opened, f);
    if (p) quick[f] = p;
  }
  const cc = await ccOf(o, place);
  const current = timeline.find((e) => e.slug === entry.slug);
  if (!current) error(500, `${key}: ${entry.slug} is not in its own timeline`);
  // Archived bytes are checked by content; Apple's by the SHA-1 it publishes. An OTA entry
  // with only a SHA-384 is not checked: #lib/binary has no SHA-384 yet.
  const verified = entry.cid ? entry.cid === id : entry.sha ? entry.sha === sha256 : entry.sha1 ? entry.sha1 === sha1 : null;
  return {
    source: key, ref: o.ref, place, cc, countryName: countryName(cc),
    entry: current,
    previous: timeline.find((e) => e.slug === o.previous?.slug) ?? null,
    timeline,
    head: o.head.slug,
    info: opened.info,
    downloadSize: bytes.length,
    contentId: id, sha256, sha1, verified, quick,
    home: o.ref.kind === "carrier" ? await homeCountry(plistOf(opened, "carrier.plist")) : null,
  };
}

export async function getFile(key: string, slug: string, path: string): Promise<DecodedFile> {
  const { opened } = await open(key, slug);
  try {
    return decodeFile(opened, path);
  } catch (e) {
    error(404, e instanceof Error ? e.message : String(e));
  }
}

export async function getRaw(key: string, slug: string, path: string): Promise<Uint8Array> {
  const { opened } = await open(key, slug);
  const bytes = opened.entries[opened.prefix + path];
  if (!bytes) error(404, `no such file: ${path}`);
  return bytes;
}

/** A country bundle's emergency alert settings at this version. */
export async function getAlerts(key: string, slug: string): Promise<CbsRow | null> {
  const { opened } = await open(key, slug);
  const plist = plistOf(opened, "carrier.plist");
  const locales = opened.info.files.filter((f) => f.path.endsWith("CBMessage.strings")).flatMap((f) => f.locale ?? []);
  return plist ? cbsRow(plist, locales) : null;
}

/* ----------------------------------------------------------------- compare */

export interface Side {
  readonly source: string;
  readonly slug?: string | undefined;
}

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
export async function getComparison(a: Side | null, b: Side, path?: string): Promise<NativeComparison> {
  const [rb, ra] = await Promise.all([resolve(b.source, b.slug), a ? resolve(a.source, a.slug) : null]);
  const left = ra ? { r: ra, entry: ra.entry } : rb.previous ? { r: rb, entry: rb.previous } : null;
  const side = async (r: Resolved, entry: TimelineEntry): Promise<ComparedSide> => {
    const [v] = await versionsOf("ios", [entry]);
    if (!v) error(500, "no version");
    return { source: r.key, ref: r.ref, entry: v };
  };
  const right = await side(rb, rb.entry);
  if (!left) return { a: null, b: right, diff: null };
  const leftSide = await side(left.r, left.entry);
  const diff = await cached(`compare:v2:${identity(left.entry)}|${identity(rb.entry)}|${path ?? ""}`, KEEP, async () => {
    const [A, B] = await Promise.all([open(leftSide.source, left.entry.slug), open(right.source, rb.entry.slug)]);
    return compareBundles(A.opened, B.opened, { ...(path ? { path } : {}), maxRows: path ? 2000 : 400 });
  });
  return { a: leftSide, b: right, diff };
}

/* ------------------------------------------------------------------ phones */

type PhoneFile = Pick<BundleFile, "path" | "kind" | "devices">;
type ReleasePhone = GroupPhone & { readonly family: string };

/** The iOS release a version is read against: its own newest image for an image entry, the current release for OTA. */
async function releaseOf(entry: TimelineEntry): Promise<string | null> {
  if (entry.via === "image") {
    const order = (await releaseList()).filter((r) => r.platform === "ios").map((r) => r.id);
    return order.find((id) => entry.releases.includes(id)) ?? entry.releases[0] ?? null;
  }
  return (await currentRelease("ios"))?.id ?? null;
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
const phoneCopies = perRequest(async (key: string, slug: string): Promise<PhoneCopies | null> => {
  const { entry, opened } = await open(key, slug);
  const build = await releaseOf(entry);
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
export async function getBundleOverrides(key: string, slug?: string): Promise<BundleOverrides | null> {
  const v = await phoneCopies(key, slug ?? "");
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
  return { build: v.build, home: homePhone(v.entry, v.devices), files: [...files.values()], defaults, unknown };
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
export async function getPhoneChanges(key: string, slug: string, against?: string): Promise<PhoneChange[] | null> {
  const { entry: b, previous } = await resolve(key, slug);
  const a = against ? (await resolve(key, against)).entry : previous;
  const vb = await phoneCopies(key, slug);
  if (!a || !vb) return null;
  return cached(`phonechanges:v4:${identity(b)}|${identity(a)}|${vb.phones.map((p) => p.id).join(",")}`, KEEP, async () => {
    const [A, B] = (await Promise.all([open(key, a.slug), open(key, slug)])).map((o) => o.opened);
    if (!A || !B) error(500, "bundle did not open");
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
      // A per-model copy only speaks for its own model.
      const before = a.productType && a.productType !== phone ? [] : filesFor(A, phone);
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
export async function getOverridePlist(key: string, slug: string, priPath: string): Promise<OverridePlist | null> {
  const path = priPath.replace(/(\.der)?\.pri$/, ".plist");
  const plist = plistOf((await open(key, slug)).opened, path);
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
export async function getBasebandDefaults(key: string, slug?: string, device?: string): Promise<ModemDefaults> {
  const v = await phoneCopies(key, slug ?? "");
  if (!v) return { missing: true, build: null };
  const phone = device ?? homePhone(v.entry, v.devices);
  const m = phone ? v.modems.find((x) => x.devices.includes(phone) && x.package.kind === "bbfw") : undefined;
  const [{ opened, ref }, s] = await Promise.all([open(key, slug ?? ""), m ? bbfwSummary(m.package.id) : null]);
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
    missing: false, build: v.build, version: release.version, family: m.family, id: m.package.id, phone, tags, overrides, otherXml,
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
export async function getBasebandOverride(key: string, slug: string | undefined, id: string, pri: string, efs: string, i: number): Promise<ModemOverride> {
  const [{ opened }, s] = await Promise.all([open(key, slug ?? ""), bbfwSummary(id)]);
  const base = s?.files[i];
  if (!base?.text || base.path !== efs) error(404, `no package file ${i} at ${efs}`);
  const value = readPri(opened, pri)?.efs.find((e) => e.path === efs)?.value;
  const text = value && priText(value);
  if (text === undefined) error(404, `${pri} does not set ${efs}`);
  const rows = diffValues(base.text.split("\n"), text.split("\n"));
  return { id, efs, pri, where: carriedBy(base), member: base.member, baseline: base.text, override: text, rows, counts: summariseDiff(rows) };
}
