/**
 * The feature index: for every carrier bundle, which consumer features (features.ts) each phone
 * gets. Written by scripts/scan_index.ts, read by the Features pages.
 *
 * Read the way the Settings page reads a phone: the current carrier.plist with the phone's own
 * override plist on top. The current copy carries every phone of its day (an image copy merges
 * every iPhone IPSW of its release), unless it is a per-model OTA copy; the newest OTA copy fills
 * in what it lacks.
 */

import { decodeFile, decodedPlist, isJsonDict, type OpenedBundle } from "#lib/decode/index.ts";
import { mergeSettings } from "#lib/decode/plist.ts";
import { describeDevices } from "#lib/decode/devices.ts";
import { FEATURES, decodeFeature, encodeFeatures, type FeatureState } from "#lib/features.ts";
import { compareProducts } from "#lib/phones.ts";

// v2: one merged copy per bundle.
export const featuresKey = (gen: string) => `scan/${gen}/_features_v2.json`;

export interface FeatureCopy {
  build: string;
  /** The one model a per-model OTA copy is for. */
  phone?: string;
  /** The newest phone the OTA copy's override files name: it was made after every phone up to it. */
  newest?: string;
  /** Phone groups by board codes, each with its encoded features. */
  groups: Array<{ boards: string[]; code: string }>;
  /** carrier.plist alone, for a phone known to have no override file. */
  base: string;
}

export interface FeatureIndex {
  /** The feature order the codes are written in. */
  features: string[];
  bundles: Record<string, FeatureCopy>;
}

const plistOf = (o: OpenedBundle, path: string) => {
  try {
    const v = decodedPlist(decodeFile(o, path));
    return isJsonDict(v) ? v : undefined;
  } catch {
    return undefined;
  }
};

const overrideFiles = (o: OpenedBundle) => o.info.files.filter((f) => /^overrides_.+\.plist$/.test(f.path) && f.devices);

/**
 * A bundle's answers from its current copy `head` (for a per-model copy, `phone` is its model) and
 * its newest OTA copy `ota`, whose override files fill in the phones `head` lacks.
 */
export function featureCopy(head: OpenedBundle, build: string, phone?: string, ota?: OpenedBundle): FeatureCopy | undefined {
  const carrier = plistOf(head, "carrier.plist");
  if (!carrier) return undefined;
  const groups: FeatureCopy["groups"] = [];
  const seen = new Set<string>();
  let newest: string | undefined;
  for (const [o, complete] of [[head, !phone], ...(ota ? [[ota, true] as const] : [])] as const) {
    for (const f of overrideFiles(o)) {
      const boards = f.devices!.map((d) => d.code).filter((b) => !seen.has(b));
      const over = boards.length ? plistOf(o, f.path) : undefined;
      if (!over) continue;
      boards.forEach((b) => seen.add(b));
      groups.push({ boards, code: encodeFeatures(mergeSettings(carrier, over)) });
    }
    if (complete) {
      for (const f of overrideFiles(o)) {
        for (const d of f.devices!) if (d.ids && (!newest || compareProducts(d.ids, newest) > 0)) newest = d.ids;
      }
    }
  }
  return { build, ...(phone ? { phone } : {}), ...(newest ? { newest } : {}), groups, base: encodeFeatures(carrier) };
}

/**
 * A feature on one phone with one bundle: its group's answer; else carrier.plist alone when the
 * phone is known to have no override file (it is the copy's own model, a complete copy made after
 * it has none for it, or the carrier has none for any phone); else unknown.
 */
export function phoneFeature(index: FeatureIndex, bundle: string, slug: string, productType: string): FeatureState | "unknown" {
  const c = index.bundles[bundle];
  if (!c) return "unknown";
  // describeDevices also reads a board the table lacks by its family (V63s as V63), as bundle pages do.
  const g = c.groups.find((x) => describeDevices(x.boards.join("_")).some((d) => d.ids === productType));
  const known = c.phone === productType || !c.groups.length || (!!c.newest && compareProducts(c.newest, productType) >= 0);
  const code = g?.code ?? (known ? c.base : undefined);
  return (code && decodeFeature(code, index.features, slug)) || "unknown";
}

export const featureSlugs = () => FEATURES.map((f) => f.slug);
