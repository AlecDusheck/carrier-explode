/**
 * Android views: one canonical carrier's CarrierSettings (a Pixel image's
 * <canonical>.pb, obj/<sha>) on one device line at one version, decoded by the
 * Android decoder. Every Android version the index lists is an image copy, so
 * the bucket holds its bytes.
 *
 * Every function takes a version as its URL names it (catalog.ts Ver): a
 * source key (`android:carrier:tmobile_us`), a device, and a version.
 */

import { error } from "@sveltejs/kit";
import { configDoc, decodeCarrierSettings, type ApnItem, type CarrierConfigValue, type CarrierSettings, type ConfigDoc } from "#lib/decode/android/index.ts";
import { diffValues, summariseDiff, type DiffCounts, type DiffRow } from "#lib/decode/index.ts";
import { base64ToBytes } from "#lib/binary/index.ts";
import { keys } from "#lib/storage/keys.ts";
import type { Json, SourceRef } from "#lib/schema/types.ts";
import { configGroup, groupOrder } from "#lib/android-groups.ts";
import type { Version } from "#lib/types.ts";
import { perRequest } from "./cache";
import { archivedSha, resolve, versionOf, type Resolved, type Ver } from "./catalog";
import { readBytes } from "./store";

interface Decoded extends Resolved {
  readonly settings: CarrierSettings;
}

/** A version decoded, once per request. */
const decodedOnce = perRequest(async (source: string, line: string, slug: string): Promise<Decoded> => {
  const r = await resolve({ source, line: line || undefined, slug: slug || undefined });
  if (r.ref.platform !== "android") error(400, `${source} is not an Android source.`);
  const sha = archivedSha(r.entry);
  const bytes = sha === undefined ? null : await readBytes(keys.obj(sha));
  if (!bytes) error(404, `Version ${r.entry.slug} is not in the bucket.`);
  return { ...r, settings: decodeCarrierSettings(bytes) };
});
const decoded = (v: Ver): Promise<Decoded> => decodedOnce(v.source, v.line ?? "", v.slug ?? "");

/** A config value as plain JSON: what the Files view and the diff read. */
export function plainConfig(v: CarrierConfigValue): Json {
  if (v.type !== "bundle") return v.value;
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
  readonly line: string | undefined;
  readonly entry: Version;
  readonly previous: Version | null;
  readonly canonicalName: string;
  /** CarrierSettings.version, the file's own. */
  readonly version: string | undefined;
  readonly counts: { readonly configs: number; readonly apns: number; readonly vendor: number };
  /** Fields the decoder did not recognise; nonzero means a proto newer than the decoder. */
  readonly unknownFields: number;
}

export async function getAndroid(v: Ver): Promise<AndroidVersion> {
  const d = await decoded(v);
  const [entry, previous] = await Promise.all([versionOf("android", d.entry), d.previous ? versionOf("android", d.previous) : null]);
  return {
    source: d.key, ref: d.ref, line: d.line, entry, previous,
    canonicalName: d.settings.canonicalName,
    version: d.settings.version,
    counts: { configs: Object.keys(d.settings.configs).length, apns: d.settings.apns.length, vendor: d.settings.vendorConfigs.length },
    unknownFields: "unknown" in d.settings && Array.isArray(d.settings.unknown) ? d.settings.unknown.length : 0,
  };
}

export interface ConfigRow {
  readonly key: string;
  readonly value: CarrierConfigValue;
  readonly doc: ConfigDoc | null;
}

export interface ConfigGroup {
  readonly title: string;
  readonly rows: readonly ConfigRow[];
}

/** Every config key, grouped for reading and documented from CarrierConfigManager's javadoc. */
export async function getAndroidSettings(v: Ver): Promise<ConfigGroup[]> {
  const { settings } = await decoded(v);
  const groups = new Map<string, ConfigRow[]>();
  for (const [key, value] of Object.entries(settings.configs).sort(([a], [b]) => a.localeCompare(b))) {
    const title = configGroup(key);
    groups.set(title, [...(groups.get(title) ?? []), { key, value, doc: configDoc(key) ?? null }]);
  }
  return [...groups].sort((a, b) => groupOrder(a[0]) - groupOrder(b[0]) || a[0].localeCompare(b[0])).map(([title, rows]) => ({ title, rows }));
}

export async function getAndroidApns(v: Ver): Promise<ShownApn[]> {
  return (await decoded(v)).settings.apns.map(shownApn);
}

/** The file's three parts, as the Files tab lists them: configs and APNs as value trees, vendor configs by size. */
export interface AndroidFiles {
  readonly configs: Readonly<Record<string, Json>>;
  readonly apns: readonly ShownApn[];
  /** Vendor configs are opaque bytes, read only by the client each names; their size is what can be shown. */
  readonly vendor: ReadonlyArray<{ readonly name: string; readonly size: number }>;
}

export async function getAndroidFiles(v: Ver): Promise<AndroidFiles> {
  const { settings } = await decoded(v);
  return {
    configs: plainConfigs(settings),
    apns: settings.apns.map(shownApn),
    vendor: settings.vendorConfigs.map((c) => ({ name: c.name, size: c.value ? base64ToBytes(c.value).length : 0 })),
  };
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
  const b = await decoded(v);
  const aSlug = against ?? b.previous?.slug;
  const a = aSlug === undefined ? null : await decoded({ ...v, slug: aSlug });
  const [vb, va] = await Promise.all([versionOf("android", b.entry), a ? versionOf("android", a.entry) : null]);
  return {
    a: va,
    b: vb,
    configs: diff(a ? plainConfigs(a.settings) : {}, plainConfigs(b.settings)),
    apns: diff(a?.settings.apns.map(shownApn) ?? [], b.settings.apns.map(shownApn)),
  };
}
