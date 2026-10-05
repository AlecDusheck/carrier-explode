/** Android views: a CarrierSettings file on one device line at one version (catalog.ts Ver), decoded. */

import { error } from "@sveltejs/kit";
import { configDoc, decodeCarrierList, decodeCarrierSettings, type ApnItem, type CarrierConfigValue, type CarrierSettings, type ConfigDoc } from "@carrier-explode/decode-android";
import { deviceModems, listSims } from "@carrier-explode/schema";
import { diffValues, summariseDiff, type DiffCounts, type DiffRow } from "@carrier-explode/values";
import { base64ToBytes, bytesToHex } from "@carrier-explode/binary";
import { keys } from "@carrier-explode/storage";
import type { Json, SimMatcher, SourceRef } from "@carrier-explode/schema/types";
import { configGroup, groupOrder } from "#lib/android/setting-groups.ts";
import type { Version } from "#lib/types.ts";
import { cached, perRequest } from "../cache";
import { releaseList, resolve, verFrom, versionOf, type Resolved } from "../catalog";
import type { Ver } from "#lib/types.ts";
import { mustRelease } from "../releases";
import { readBytes } from "../store";

interface Decoded extends Resolved {
  readonly settings: CarrierSettings;
  readonly sha: string;
  /** The stored file's size. */
  readonly size: number;
}

/** A version decoded, once per request. */
const decodedOnce = perRequest(async (source: string, line: string, slug: string): Promise<Decoded> => {
  const r = await resolve(verFrom(source, line, slug));
  if (r.ref.platform !== "android") error(400, `${source} is not an Android source.`);
  const sha = r.entry.sha;
  const bytes = await readBytes(keys.obj(sha));
  if (!bytes) error(404, `Version ${r.entry.slug} is not in the bucket.`);
  return { ...r, settings: decodeCarrierSettings(bytes), sha, size: bytes.length };
});
const decoded = (v: Ver): Promise<Decoded> => decodedOnce(v.source, v.line ?? "", v.slug ?? "");

/** A config value as plain JSON: what the Files view and the diff read. */
export function plainConfig(v: CarrierConfigValue): Json {
  if (v.kind !== "bundle") return v.value;
  return Object.fromEntries(Object.entries(v.value).map(([k, x]) => [k, plainConfig(x)]));
}

const plainConfigs = (s: CarrierSettings): Record<string, Json> =>
  Object.fromEntries(Object.entries(s.configs).map(([k, v]) => [k, plainConfig(v)]));

/** An APN as shown: the password is never republished, only whether there is one. */
export type ShownApn = Omit<ApnItem, "password"> & { readonly hasPassword: boolean };
const shownApn = ({ password, ...rest }: ApnItem): ShownApn => ({ ...rest, hasPassword: !!password });

export interface AndroidVersion {
  readonly source: string;
  readonly ref: SourceRef;
  readonly line: string | null;
  readonly entry: Version;
  readonly previous: Version | null;
  readonly canonicalName: string;
  /** CarrierSettings.version, the file's own. */
  readonly version: string | undefined;
  /** `modems`: the modem configurations the carrier's SIMs select on this device. */
  readonly counts: { readonly configs: number; readonly apns: number; readonly modems: number };
  /** Fields the decoder did not recognise; nonzero means a proto newer than the decoder. */
  readonly unknownFields: number;
  /** The stored CarrierSettings file, as the Files tab names it. */
  readonly file: AndroidFileRow & { readonly sha: string };
}

export async function getAndroid(v: Ver): Promise<AndroidVersion> {
  const d = await decoded(v);
  const [entry, previous] = await Promise.all([versionOf("android", d.entry), d.previous ? versionOf("android", d.previous) : null]);
  return {
    source: d.key, ref: d.ref, line: d.line, entry, previous,
    canonicalName: d.settings.canonicalName,
    version: d.settings.version,
    counts: {
      configs: Object.keys(d.settings.configs).length, apns: d.settings.apns.length,
      modems: deviceModems(d.modems, d.line).length,
    },
    unknownFields: d.settings.unknown.length,
    file: { path: settingsPath(d.settings), kind: "settings", size: d.size, sha: d.sha },
  };
}

export interface AndroidSettings {
  /** Every config key, grouped for reading, as plain values for the value tree. */
  readonly groups: ReadonlyArray<{ readonly title: string; readonly values: Readonly<Record<string, Json>> }>;
  /** CarrierConfigManager's javadoc for the keys shown: all of it is too large to send. */
  readonly docs: Readonly<Record<string, ConfigDoc>>;
}

export async function getAndroidSettings(v: Ver): Promise<AndroidSettings> {
  const { settings } = await decoded(v);
  const groups = new Map<string, Record<string, Json>>();
  const docs: Record<string, ConfigDoc> = {};
  for (const [key, value] of Object.entries(settings.configs).sort(([a], [b]) => a.localeCompare(b))) {
    const title = configGroup(key);
    groups.set(title, { ...groups.get(title), [key]: plainConfig(value) });
    const doc = configDoc(key);
    if (doc) docs[key] = doc;
  }
  return {
    groups: [...groups].sort((a, b) => groupOrder(a[0]) - groupOrder(b[0]) || a[0].localeCompare(b[0])).map(([title, values]) => ({ title, values })),
    docs,
  };
}

export async function getAndroidApns(v: Ver): Promise<ShownApn[]> {
  return (await decoded(v)).settings.apns.map(shownApn);
}

/** A version's files, as the Files tab lists them: the CarrierSettings file, its vendor configs, and carrier_list.pb's entries naming it. */
export type AndroidFileKind = "settings" | "vendor" | "carrier-list";

export interface AndroidFileRow {
  readonly path: string;
  readonly kind: AndroidFileKind;
  readonly size: number;
}

export type AndroidFile =
  | {
      readonly kind: "settings";
      readonly path: string;
      readonly canonicalName: string;
      readonly version: string | null;
      readonly configs: Readonly<Record<string, Json>>;
      readonly docs: Readonly<Record<string, ConfigDoc>>;
      readonly apns: readonly ShownApn[];
      /** Each opens as a file of its own. */
      readonly vendor: readonly AndroidFileRow[];
    }
  | { readonly kind: "vendor"; readonly path: string; readonly hex: string }
  | { readonly kind: "carrier-list"; readonly path: string; readonly selectedBy: SelectedBy };

/** A part of others.pb has no version of its own (android.ota refuses one that does), so it is named as a part. */
const settingsPath = (s: CarrierSettings): string => (s.version === undefined ? `others.pb/${s.canonicalName}` : `${s.canonicalName}.pb`);
const vendorPath = (name: string): string => `vendor_configs/${name}`;
const CARRIER_LIST = "carrier_list.pb";

const vendorRows = (s: CarrierSettings): AndroidFileRow[] =>
  s.vendorConfigs.map((c) => ({ path: vendorPath(c.name), kind: "vendor", size: c.value ? base64ToBytes(c.value).length : 0 }));

/** carrier_list.pb's rules naming one canonical: which SIMs load the file. */
export interface SelectedBy {
  readonly version: string | null;
  /** Every entry in the file, of every carrier. */
  readonly total: number;
  readonly size: number;
  /** The SIM rules naming it, one per distinct rule. */
  readonly sims: readonly SimMatcher[];
}

const selectedBy = (listSha: string, name: string): Promise<SelectedBy> =>
  cached(`selectedby:v2:${listSha}:${name}`, async () => {
    const bytes = await readBytes(keys.obj(listSha));
    if (!bytes) error(500, `${keys.obj(listSha)} is not in the bucket.`);
    const list = decodeCarrierList(bytes);
    return {
      version: list.version ?? null,
      total: list.entries.length,
      size: bytes.length,
      sims: listSims(list, name),
    };
  });

/** The carrier list of the newest release shipping the version. */
async function versionCarrierList(d: Decoded): Promise<string> {
  const shipping = new Set(d.entry.copies.flatMap((c) => (c.kind === "image" ? c.releases : [])));
  const newest = (await releaseList()).find((r) => r.platform === "android" && shipping.has(r.id));
  if (!newest) error(500, `${d.key} ${d.entry.slug}: no release ships it.`);
  return (await mustRelease("android", newest.id)).carrierList;
}

export async function getAndroidFiles(v: Ver): Promise<AndroidFileRow[]> {
  const d = await decoded(v);
  const list = await selectedBy(await versionCarrierList(d), d.settings.canonicalName);
  return [
    { path: settingsPath(d.settings), kind: "settings", size: d.size },
    ...vendorRows(d.settings),
    { path: CARRIER_LIST, kind: "carrier-list", size: list.size },
  ];
}

export async function getAndroidFile(v: Ver, path: string): Promise<AndroidFile> {
  const d = await decoded(v);
  if (path === settingsPath(d.settings)) {
    const docs = Object.fromEntries(Object.keys(d.settings.configs).flatMap((k) => {
      const doc = configDoc(k);
      return doc ? [[k, doc]] : [];
    }));
    return {
      kind: "settings", path, canonicalName: d.settings.canonicalName, version: d.settings.version ?? null,
      configs: plainConfigs(d.settings), docs, apns: d.settings.apns.map(shownApn), vendor: vendorRows(d.settings),
    };
  }
  if (path === CARRIER_LIST) return { kind: "carrier-list", path, selectedBy: await selectedBy(await versionCarrierList(d), d.settings.canonicalName) };
  const vendor = d.settings.vendorConfigs.find((c) => vendorPath(c.name) === path);
  if (vendor) return { kind: "vendor", path, hex: bytesToHex(vendor.value ? base64ToBytes(vendor.value) : new Uint8Array()) };
  error(404, `${d.ref.name} ${d.entry.slug} has no file ${path}.`);
}

export interface AndroidChanges {
  readonly a: Version | null;
  readonly b: Version;
  readonly configs: { readonly rows: readonly DiffRow[]; readonly counts: DiffCounts };
  readonly apns: { readonly rows: readonly DiffRow[]; readonly counts: DiffCounts };
}

const diff = (x: unknown, y: unknown): { rows: DiffRow[]; counts: DiffCounts } => {
  const rows = diffValues(x, y);
  return { rows, counts: summariseDiff(rows) };
};

/** A version against the one before it on its device line, or against `against` on that line: config keys and APNs. */
export async function getAndroidChanges(v: Ver, against?: string): Promise<AndroidChanges> {
  const aSlug = against ?? (await decoded(v)).previous?.slug;
  return getAndroidComparison(aSlug === undefined ? null : { ...v, slug: aSlug }, v);
}

/** Any two Android versions, config key by key and APN by APN: what /compare shows for two Pixel files. */
export async function getAndroidComparison(av: Ver | null, bv: Ver): Promise<AndroidChanges> {
  const [a, b] = await Promise.all([av ? decoded(av) : null, decoded(bv)]);
  const [vb, va] = await Promise.all([versionOf("android", b.entry), a ? versionOf("android", a.entry) : null]);
  return {
    a: va,
    b: vb,
    configs: diff(a ? plainConfigs(a.settings) : {}, plainConfigs(b.settings)),
    apns: diff(a?.settings.apns.map(shownApn) ?? [], b.settings.apns.map(shownApn)),
  };
}
