/**
 * The Features pages: one consumer feature (a `state` concept) for every
 * carrier, on one iPhone or one Pixel, from the feature states each carrier
 * document carries per device group. A table reads every document, so it is
 * kept as long as the carrier list is the same.
 */

import { error } from "@sveltejs/kit";
import { modemVendor } from "#lib/decode/index.ts";
import { keys } from "#lib/storage/keys.ts";
import { parseSourceKey, sourceKey, sourcePath, type DeviceStates, type FeatureState, type Platform } from "#lib/schema/types.ts";
import { FEATURES, featureBySlug } from "#lib/features.ts";
import { getModems } from "./baseband";
import { cached, perRequest } from "./cache";
import { carrierList, currentRelease, locate } from "./catalog";
import { named } from "./devices";
import { etagOf } from "./store";

/** The platforms the feature pages ask about, one device line each. */
const ASKED = ["ios", "android"] as const satisfies readonly Platform[];
type Asked = (typeof ASKED)[number];

export interface FeaturePhone {
  readonly id: string;
  readonly name: string;
  readonly platform: Asked;
  /** No 5G modem: Apple's Intel-modem iPhones. */
  readonly lte: boolean;
}

/** The current releases' named iPhones, then their Pixels, newest first. */
export const featurePhones = perRequest(async (): Promise<FeaturePhone[]> => {
  const [ios, android] = await Promise.all([currentRelease("ios"), currentRelease("android")]);
  const lte = new Map<string, boolean>();
  if (ios) for (const m of (await getModems(ios.id)).modems) for (const d of m.devices) if (d.name) lte.set(d.id, modemVendor(m.family) === "intel");
  return [
    ...named("ios", [...lte.keys()]).map((p): FeaturePhone => ({ ...p, platform: "ios", lte: lte.get(p.id) ?? false })),
    ...named("android", android?.devices ?? []).map((p): FeaturePhone => ({ ...p, platform: "android", lte: false })),
  ];
});

interface SourceStates {
  readonly path: string;
  readonly name: string;
  readonly cc: string | undefined;
  readonly platform: Platform;
  readonly states: readonly DeviceStates[];
}

/** Every carrier source's feature states. */
const allStates = perRequest(async (): Promise<SourceStates[]> => {
  const tag = await etagOf(keys.carrierIndex());
  return cached(`featurestates:v2:${tag ?? "none"}`, 86400, async () => {
    const sources = (await carrierList()).flatMap((c) => c.members.flatMap((k) => {
      const ref = parseSourceKey(k);
      return ref?.kind === "carrier" ? [{ ref, cc: c.iso }] : [];
    }));
    return Promise.all(sources.map(async ({ ref, cc }): Promise<SourceStates> =>
      ({ path: sourcePath(ref), name: ref.name, cc, platform: ref.platform, states: (await locate(sourceKey(ref))).states })));
  });
});

function stateFor(groups: readonly DeviceStates[], phone: string, feature: string): FeatureState | "unknown" {
  const group = groups.find((g) => g.devices !== "rest" && g.devices.includes(phone)) ?? groups.find((g) => g.devices === "rest");
  return group?.states[feature] ?? "unknown";
}

async function mustPhone(id: string): Promise<FeaturePhone> {
  const phone = (await featurePhones()).find((p) => p.id === id);
  if (!phone) error(404, `No phone ${id} in the current releases.`);
  return phone;
}

const unusable = (slug: string, phone: FeaturePhone): boolean => !!featureBySlug(slug)?.needs5G && phone.lte;

export interface FeatureRow {
  readonly path: string;
  readonly name: string;
  readonly cc: string | undefined;
  readonly state: FeatureState | "unknown";
}

export type FeatureTable = { readonly unusable: true } | { readonly unusable: false; readonly rows: readonly FeatureRow[] };

export async function getFeatureTable(slug: string, phoneId: string): Promise<FeatureTable> {
  if (!featureBySlug(slug)) error(404, `no feature ${slug}`);
  const phone = await mustPhone(phoneId);
  if (unusable(slug, phone)) return { unusable: true };
  const rows = (await allStates())
    .filter((s) => s.platform === phone.platform)
    .map((s): FeatureRow => ({ path: s.path, name: s.name, cc: s.cc, state: stateFor(s.states, phone.id, slug) }));
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
  const sources = all.filter((s) => s.platform === phone.platform);
  return FEATURES.map((f) => {
    const counts = { on: 0, available: 0, no: 0, unknown: 0 };
    const no = unusable(f.slug, phone);
    if (!no) for (const s of sources) counts[stateFor(s.states, phone.id, f.slug)]++;
    return { slug: f.slug, counts, of: sources.length, unusable: no };
  });
}
