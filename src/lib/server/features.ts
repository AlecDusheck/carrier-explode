/**
 * The Features pages: one consumer feature (features.ts, a `state` concept of
 * the schema) for every carrier, on one iPhone or one Pixel. The answers are
 * the index's: each carrier document carries its sources' feature states per
 * device group (CarrierDoc.states), so nothing is decoded here. A table is
 * every document's states at once, kept as long as the carrier list is the same.
 */

import { error } from "@sveltejs/kit";
import { compareProducts, modemVendor, splitName } from "#lib/decode/index.ts";
import { byPixelRank, pixelName } from "#lib/schema/index.ts";
import { parseSourceKey, type DeviceStates, type FeatureState, type Platform } from "#lib/schema/types.ts";
import { keys } from "#lib/storage/keys.ts";
import { FEATURES, featureBySlug } from "#lib/features.ts";
import { getModems } from "./baseband";
import { cached, perRequest } from "./cache";
import { carrierList, currentRelease, pageOf } from "./catalog";
import { etagOf } from "./store";

export interface FeaturePhone {
  /** iPhone product type or Pixel codename. */
  readonly id: string;
  readonly name: string;
  readonly platform: Platform;
  /** No 5G modem: Apple's Intel-modem iPhones. */
  readonly lte: boolean;
}

/** The phones a feature page can be asked about: the current releases' iPhones that have a name, then their Pixels; newest first. */
export const featurePhones = perRequest(async (): Promise<FeaturePhone[]> => {
  const [ios, android] = await Promise.all([currentRelease("ios"), currentRelease("android")]);
  const iphones = new Map<string, FeaturePhone>();
  if (ios) {
    for (const m of (await getModems(ios.id)).modems) {
      for (const d of m.devices) if (d.name) iphones.set(d.id, { id: d.id, name: d.name, platform: "ios", lte: modemVendor(m.family) === "intel" });
    }
  }
  const pixels = [...(android?.devices ?? [])].sort(byPixelRank).map((id): FeaturePhone => ({ id, name: pixelName(id), platform: "android", lte: false }));
  return [...[...iphones.values()].sort((x, y) => compareProducts(y.id, x.id)), ...pixels];
});

/** One list row's feature states on each platform it has. */
interface PageStates {
  readonly name: string;
  readonly display: string;
  readonly cc: string | undefined;
  readonly states: Readonly<Partial<Record<Platform, readonly DeviceStates[]>>>;
}

/** Every carrier page's states: each iOS bundle row with its carrier's Android states, and Android-only carriers. */
const allStates = perRequest(async (): Promise<PageStates[]> => {
  const tag = await etagOf(keys.carriers());
  return cached(`featurestates:v1:${tag ?? "none"}`, 86400, async () => {
    const rows = (await carrierList()).flatMap((c) => {
      const ios = c.members.flatMap((k) => {
        const ref = parseSourceKey(k);
        return ref?.platform === "ios" && ref.kind === "carrier" && !ref.family ? [ref.name] : [];
      });
      return (ios.length ? ios : [c.slug]).map((name) => ({ name, display: ios.length ? splitName(name).display : c.name, cc: c.iso }));
    });
    return Promise.all(rows.map(async (r): Promise<PageStates> => {
      const page = await pageOf("carriers", r.name);
      const of = (p: Platform): readonly DeviceStates[] | undefined => {
        const line = page.lines[p];
        return line ? page.doc.states?.[line] : undefined;
      };
      const ios = of("ios"), android = of("android");
      return { ...r, states: { ...(ios ? { ios } : {}), ...(android ? { android } : {}) } };
    }));
  });
});

/** The group a phone reads: the one naming it, else (iOS) the bundle's own carrier.plist group. */
function stateFor(groups: readonly DeviceStates[], phone: string, feature: string): FeatureState | "unknown" {
  const group = groups.find((g) => g.devices?.includes(phone)) ?? groups.find((g) => g.devices === undefined);
  return group?.states[feature] ?? "unknown";
}

async function mustPhone(id: string): Promise<FeaturePhone> {
  const phone = (await featurePhones()).find((p) => p.id === id);
  if (!phone) error(404, `No phone ${id} in the current releases.`);
  return phone;
}

const unusable = (slug: string, phone: FeaturePhone): boolean => !!featureBySlug(slug)?.needs5G && phone.lte;

export interface FeatureRow {
  readonly name: string;
  readonly display: string;
  readonly cc: string | undefined;
  readonly state: FeatureState | "unknown";
}

export type FeatureTable = { readonly unusable: true; readonly rows: readonly [] } | { readonly unusable: false; readonly rows: readonly FeatureRow[] };

/** One feature for every carrier with settings for the phone's platform. */
export async function getFeatureTable(slug: string, phoneId: string): Promise<FeatureTable> {
  if (!featureBySlug(slug)) error(404, `no feature ${slug}`);
  const phone = await mustPhone(phoneId);
  if (unusable(slug, phone)) return { unusable: true, rows: [] };
  const rows = (await allStates()).flatMap((p): FeatureRow[] => {
    const groups = p.states[phone.platform];
    return groups ? [{ name: p.name, display: p.display, cc: p.cc, state: stateFor(groups, phone.id, slug) }] : [];
  });
  return { unusable: false, rows };
}

export interface FeatureCount {
  readonly slug: string;
  readonly counts: Readonly<Record<FeatureState | "unknown", number>>;
  readonly of: number;
  readonly unusable: boolean;
}

/** How many carriers offer each feature on one phone. */
export async function getFeatureSummary(phoneId: string): Promise<FeatureCount[]> {
  const [phone, all] = await Promise.all([mustPhone(phoneId), allStates()]);
  const pages = all.filter((p) => p.states[phone.platform]);
  return FEATURES.map((f) => {
    const counts = { on: 0, available: 0, no: 0, unknown: 0 };
    const no = unusable(f.slug, phone);
    if (!no) for (const p of pages) counts[stateFor(p.states[phone.platform] ?? [], phone.id, f.slug)]++;
    return { slug: f.slug, counts, of: pages.length, unusable: no };
  });
}
