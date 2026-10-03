/**
 * The feature index: for every carrier bundle, which consumer features (features.ts) each phone
 * gets. Written by scripts/scan_index.ts, read by the Features pages.
 *
 * Read the way the Settings page reads a phone: the bundle's current copy, carrier.plist with the
 * phone's own override plist on top, or carrier.plist alone for a phone it has no file for. That
 * copy is what every phone on a release loads, and carries every iPhone's files (image copies
 * merge every iPhone IPSW of their release).
 */

import { decodeFile, decodedPlist, isJsonDict, type OpenedBundle } from "#lib/decode/index.ts";
import { mergeSettings } from "#lib/decode/plist.ts";
import { describeDevices } from "#lib/decode/devices.ts";
import { FEATURES, decodeFeature, encodeFeatures, type FeatureState } from "#lib/features.ts";

// v3: one copy per bundle, the current one.
export const featuresKey = (gen: string) => `scan/${gen}/_features_v3.json`;

export interface FeatureCopy {
  build: string;
  /** The one model a per-model OTA copy is for; other phones do not load it. */
  phone?: string;
  /** Phone groups by board codes, each with its encoded features. */
  groups: Array<{ boards: string[]; code: string }>;
  /** carrier.plist alone, for a phone with no override file. */
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

/** A bundle's answers from its current copy (for a per-model copy, `phone` is its model). */
export function featureCopy(o: OpenedBundle, build: string, phone?: string): FeatureCopy | undefined {
  const carrier = plistOf(o, "carrier.plist");
  if (!carrier) return undefined;
  const groups: FeatureCopy["groups"] = [];
  for (const f of o.info.files) {
    if (!/^overrides_.+\.plist$/.test(f.path) || !f.devices) continue;
    const over = plistOf(o, f.path);
    if (over) groups.push({ boards: f.devices.map((d) => d.code), code: encodeFeatures(mergeSettings(carrier, over)) });
  }
  return { build, ...(phone ? { phone } : {}), groups, base: encodeFeatures(carrier) };
}

/** A feature on one phone with one bundle: its group's answer, else carrier.plist's; unknown only for another model's copy. */
export function phoneFeature(index: FeatureIndex, bundle: string, slug: string, productType: string): FeatureState | "unknown" {
  const c = index.bundles[bundle];
  if (!c || (c.phone && c.phone !== productType)) return "unknown";
  // describeDevices also reads a board the table lacks by its family (V63s as V63), as bundle pages do.
  const g = c.groups.find((x) => describeDevices(x.boards.join("_")).some((d) => d.ids === productType));
  return decodeFeature(g?.code ?? c.base, index.features, slug) ?? "unknown";
}

export const featureSlugs = () => FEATURES.map((f) => f.slug);
