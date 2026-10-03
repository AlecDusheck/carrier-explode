/**
 * Android native views: one canonical carrier's CarrierSettings (a Pixel
 * image's <canonical>.pb, obj/<sha>) at one version, decoded by the Android
 * decoder. Every Android version the index lists is archived, so there is no
 * upstream fallback here.
 *
 * Every function takes a source key (`android:carrier:tmobile_us`) and a
 * timeline slug; no slug means the head version.
 */

import { error } from "@sveltejs/kit";
import { configDoc, decodeCarrierSettings, type ApnItem, type CarrierConfigValue, type CarrierSettings, type ConfigDoc } from "#lib/decode/android/index.ts";
import { diffValues, summariseDiff, type DiffCounts, type DiffRow } from "#lib/decode/index.ts";
import { base64ToBytes } from "#lib/binary/index.ts";
import { keys } from "#lib/storage/keys.ts";
import type { Json, SourceRef, TimelineEntry } from "#lib/schema/types.ts";
import { configGroup, groupOrder } from "#lib/android-groups.ts";
import type { Version } from "#lib/types.ts";
import { perRequest } from "./cache";
import { resolve, versionsOf, type Resolved } from "./catalog";
import { readBytes } from "./store";

interface Decoded extends Resolved {
  readonly settings: CarrierSettings;
}

async function decodeEntry(e: TimelineEntry): Promise<CarrierSettings> {
  const sha = e.copies.flatMap((c) => c.sha ?? [])[0];
  const bytes = sha === undefined ? null : await readBytes(keys.obj(sha));
  if (!bytes) error(404, `Version ${e.slug} is not in the bucket.`);
  return decodeCarrierSettings(bytes);
}

/** A version decoded, once per request. `slug` "" is the head. */
const decoded = perRequest(async (key: string, slug: string): Promise<Decoded> => {
  const r = await resolve(key, slug || undefined);
  if (r.ref.platform !== "android") error(400, `${key} is not an Android source.`);
  return { ...r, settings: await decodeEntry(r.entry) };
});

/** A config value as plain JSON: what the raw view and the diff read. */
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
  readonly entry: Version;
  readonly previous: Version | null;
  readonly timeline: readonly Version[];
  readonly head: string;
  readonly canonicalName: string;
  /** CarrierSettings.version, the file's own. */
  readonly version: string | undefined;
  readonly counts: { readonly configs: number; readonly apns: number; readonly vendor: number };
  /** Fields the decoder did not recognise; nonzero means a proto newer than the decoder. */
  readonly unknownFields: number;
}

export async function getAndroid(key: string, slug?: string): Promise<AndroidVersion> {
  const d = await decoded(key, slug ?? "");
  const timeline = await versionsOf("android", d.timeline);
  const entry = timeline.find((e) => e.slug === d.entry.slug);
  if (!entry) error(500, `${key}: ${d.entry.slug} is not in its own timeline`);
  const unknown = "unknown" in d.settings && Array.isArray(d.settings.unknown) ? d.settings.unknown.length : 0;
  return {
    source: key, ref: d.ref, entry,
    previous: timeline.find((e) => e.slug === d.previous?.slug) ?? null,
    timeline, head: d.head.slug,
    canonicalName: d.settings.canonicalName,
    version: d.settings.version,
    counts: { configs: Object.keys(d.settings.configs).length, apns: d.settings.apns.length, vendor: d.settings.vendorConfigs.length },
    unknownFields: unknown,
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
export async function getAndroidSettings(key: string, slug: string): Promise<ConfigGroup[]> {
  const { settings } = await decoded(key, slug);
  const groups = new Map<string, ConfigRow[]>();
  for (const k of Object.keys(settings.configs).sort()) {
    const value = settings.configs[k];
    if (!value) continue;
    const title = configGroup(k);
    groups.set(title, [...(groups.get(title) ?? []), { key: k, value, doc: configDoc(k) ?? null }]);
  }
  return [...groups].sort((a, b) => groupOrder(a[0]) - groupOrder(b[0]) || a[0].localeCompare(b[0])).map(([title, rows]) => ({ title, rows }));
}

export async function getAndroidApns(key: string, slug: string): Promise<ShownApn[]> {
  return (await decoded(key, slug)).settings.apns.map(shownApn);
}

export interface AndroidRaw {
  readonly configs: Readonly<Record<string, Json>>;
  /** Vendor configs are opaque bytes; their size is what can be shown. */
  readonly vendor: ReadonlyArray<{ readonly name: string; readonly size: number }>;
}

export async function getAndroidRaw(key: string, slug: string): Promise<AndroidRaw> {
  const { settings } = await decoded(key, slug);
  return {
    configs: plainConfigs(settings),
    vendor: settings.vendorConfigs.map((c) => ({ name: c.name, size: c.value ? base64ToBytes(c.value).length : 0 })),
  };
}

export interface AndroidChanges {
  readonly a: Version | null;
  readonly b: Version;
  readonly configs: { readonly rows: readonly DiffRow[]; readonly counts: DiffCounts };
  readonly apns: { readonly rows: readonly DiffRow[]; readonly counts: DiffCounts };
}

/** A version against the one before it, or against `against`: config keys and APNs. */
export async function getAndroidChanges(key: string, slug: string, against?: string): Promise<AndroidChanges> {
  const b = await decoded(key, slug);
  const aSlug = against ?? b.previous?.slug;
  const a = aSlug === undefined ? null : await decoded(key, aSlug);
  const [vb, va] = await versionsOf("android", [b.entry, ...(a ? [a.entry] : [])]);
  if (!vb) error(500, `${key}: no version`);
  const diff = (x: unknown, y: unknown): { rows: DiffRow[]; counts: DiffCounts } => {
    const rows = diffValues(x, y);
    return { rows, counts: summariseDiff(rows) };
  };
  return {
    a: va ?? null,
    b: vb,
    configs: diff(a ? plainConfigs(a.settings) : {}, plainConfigs(b.settings)),
    apns: diff(a?.settings.apns.map(shownApn) ?? [], b.settings.apns.map(shownApn)),
  };
}
