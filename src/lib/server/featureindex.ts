/**
 * The feature index: for every carrier bundle, which consumer features (features.ts) each phone
 * gets. Written by scripts/scan_index.ts, read by the Features pages. A copy inside an iOS image
 * carries only the override files of the phones that image was cut for, so each bundle keeps two
 * copies: its current version and its newest OTA, which carries every phone of its day.
 */

import { decodeFile, decodedPlist, isJsonDict, type OpenedBundle } from "#lib/decode/index.ts";
import { DEVICE_CODENAMES } from "#lib/decode/devices.ts";
import { FEATURES, decodeFeature, encodeFeatures, type FeatureState } from "#lib/features.ts";
import { compareProducts } from "#lib/phones.ts";
import { mergeSettings } from "#lib/settings.ts";

export const featuresKey = (gen: string) => `scan/${gen}/_features.json`;

export interface FeatureCopy {
  build: string;
  source: "ota" | "image";
  /** The one model an image or per-model copy is for (homePhone); it speaks for no phone beyond that and its own override files. */
  phone?: string;
  /** The newest phone any override file in this copy names: phones newer than it postdate the copy. */
  newest?: string;
  /** Phone groups as the copy files them, by board codes, with their encoded features. */
  groups: Array<{ boards: string[]; code: string }>;
  /** carrier.plist alone, for a phone the copy knew but gave no file. */
  base: string;
}

export interface FeatureIndex {
  /** The feature order the codes are written in. */
  features: string[];
  /** Per bundle name, its copies, the current one first. */
  bundles: Record<string, FeatureCopy[]>;
}

const plistOf = (o: OpenedBundle, path: string) => {
  try {
    const v = decodedPlist(decodeFile(o, path));
    return isJsonDict(v) ? v : undefined;
  } catch {
    return undefined;
  }
};

/** One copy's answers: carrier.plist alone, and merged with each phone group's override plist. */
export function featureCopy(o: OpenedBundle, build: string, source: "ota" | "image", phone?: string): FeatureCopy | undefined {
  const carrier = plistOf(o, "carrier.plist");
  if (!carrier) return undefined;
  const groups: FeatureCopy["groups"] = [];
  let newest: string | undefined;
  for (const f of o.info.files) {
    if (!/^overrides_.+\.plist$/.test(f.path) || !f.devices) continue;
    const over = plistOf(o, f.path);
    if (!over) continue;
    groups.push({ boards: f.devices.map((d) => d.code), code: encodeFeatures(mergeSettings(carrier, over)) });
    for (const d of f.devices) if (d.ids && (!newest || compareProducts(d.ids, newest) > 0)) newest = d.ids;
  }
  return { build, source, ...(phone ? { phone } : {}), newest, groups, base: encodeFeatures(carrier) };
}

/** Board codes a product type goes by ("iPhone19,3" -> V64). */
const boardsOf = (productType: string) =>
  Object.entries(DEVICE_CODENAMES).filter(([, d]) => d.ids === productType).map(([code]) => code);

export interface PhoneFeature {
  state: FeatureState | "unknown";
  /** The copy the answer comes from. */
  from?: { build: string; source: "ota" | "image" };
}

/**
 * Whether a copy gives a phone without an override file of its own carrier.plist alone. An image or
 * per-model copy only knows its own phone. Any other OTA copy knows every phone up to the newest its
 * files name, and one with no override files at all is a carrier that sets nothing per phone.
 */
const basedFor = (c: FeatureCopy, productType: string) =>
  c.phone
    ? c.phone === productType
    : !c.groups.length || (!!c.newest && compareProducts(c.newest, productType) >= 0);

/** A feature on one phone with one bundle: the first copy that knows the phone answers; none is unknown. */
export function phoneFeature(index: FeatureIndex, bundle: string, slug: string, productType: string): PhoneFeature {
  const boards = new Set(boardsOf(productType));
  for (const c of index.bundles[bundle] ?? []) {
    const g = c.groups.find((x) => x.boards.some((b) => boards.has(b)));
    const code = g?.code ?? (basedFor(c, productType) ? c.base : undefined);
    const state = code && decodeFeature(code, index.features, slug);
    if (state) return { state, from: { build: c.build, source: c.source } };
  }
  return { state: "unknown" };
}

export const featureSlugs = () => FEATURES.map((f) => f.slug);
