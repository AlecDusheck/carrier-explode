/**
 * iOS against Android: the Overview's "iOS and Android" section, and /compare
 * when its two sides are on different platforms. Feature states come from the
 * index (CarrierDoc.states, per device group); everything else from the two
 * versions' Profiles (norm/v<N>/<sha>.json), compared by the schema's
 * compareProfiles.
 *
 * Both platforms decide per phone: an iOS bundle carries per-iPhone override
 * files, and an Android build ships one file per Pixel generation. So a side
 * is read for one phone, the newest unless one is named, and a feature whose
 * answer differs between phones says so.
 */

import { error } from "@sveltejs/kit";
import { compareProducts, productName } from "#lib/decode/index.ts";
import { keys } from "#lib/storage/keys.ts";
import { byPixelRank, compareProfiles, pixelName, type ConceptRow, type ProfileComparison } from "#lib/schema/index.ts";
import type { DeviceStates, FeatureState, Platform, Profile } from "#lib/schema/types.ts";
import type { Kind, Version } from "#lib/types.ts";
import { perRequest } from "./cache";
import { pageOf, resolve, versionOf } from "./catalog";
import { readJson } from "./store";
import * as records from "./records";

const profileOf = perRequest((sha: string) => readJson(keys.norm(sha), records.profile));

export interface PhoneName {
  /** iPhone product type or Pixel codename. */
  readonly id: string;
  readonly name: string;
}

const NAMES = {
  ios: (id: string): string => productName(id) ?? id,
  android: pixelName,
} as const satisfies Record<Platform, (id: string) => string>;

/** Newest first, per platform: product types by model, codenames by Pixel generation. */
const NEWEST = {
  ios: (a: string, b: string): number => compareProducts(b, a),
  android: byPixelRank,
} as const satisfies Record<Platform, (a: string, b: string) => number>;

/** What a side without per-phone files is read for. */
const EVERY = { ios: "every iPhone", android: "every Pixel" } as const satisfies Record<Platform, string>;

/** A feature whose answer differs between a source's phones: each answer and who gets it. */
export interface Spread {
  readonly state: FeatureState | "not set";
  readonly phones: readonly string[];
}

export interface PairSide {
  readonly platform: Platform;
  /** The version the side was read at. */
  readonly version: Version;
  readonly phone: PhoneName;
  readonly phones: readonly PhoneName[];
  readonly states: Readonly<Record<string, FeatureState>>;
  /** Feature id -> answers per phone, only where the phones disagree. */
  readonly spread: Readonly<Record<string, readonly Spread[]>>;
}

export interface Pair {
  readonly ios: PairSide;
  readonly android: PairSide;
  /** A few concepts besides the features, iOS (a) against Android (b). */
  readonly headline: readonly ConceptRow[];
}

/** Concepts worth a line beside the features: the ones people ask a carrier about. */
const HEADLINE = ["nr-modes", "wfc-mode", "sms-over-ims", "mms-max-size", "apn-internet", "emergency-numbers"] as const;

function spreadOf(groups: readonly DeviceStates[], names: (id: string) => string): Record<string, Spread[]> {
  const features = new Set(groups.flatMap((g) => Object.keys(g.states)));
  const out: Record<string, Spread[]> = {};
  for (const f of features) {
    const by = new Map<FeatureState | "not set", string[]>();
    for (const g of groups) {
      const state = g.states[f] ?? "not set";
      const phones = g.devices?.map(names) ?? ["other iPhones"];
      by.set(state, [...(by.get(state) ?? []), ...phones]);
    }
    if (by.size > 1) out[f] = [...by].map(([state, phones]) => ({ state, phones }));
  }
  return out;
}

/** One side read for one phone: the group that names it, else the group for every other phone. */
async function sideOf(platform: Platform, source: string, groups: readonly DeviceStates[], wanted: string | undefined): Promise<{ side: PairSide; profile: Profile } | null> {
  const ids = [...new Set(groups.flatMap((g) => g.devices ?? []))].sort(NEWEST[platform]);
  const id = wanted !== undefined && ids.includes(wanted) ? wanted : ids[0];
  const group = groups.find((g) => id !== undefined && g.devices?.includes(id)) ?? groups.find((g) => g.devices === undefined);
  if (!group) return null;
  const { entry } = await resolve(source, group.slug);
  const profile = entry.sha ? await profileOf(entry.sha) : null;
  if (!profile) return null;
  // An iOS group is the bundle's carrier.plist with one phone's override file on top: Profile.variants.
  const variant = id === undefined ? undefined : profile.variants.find((v) => v.when.devices?.includes(id));
  const read = variant ? { ...profile, concepts: { ...profile.concepts, ...variant.concepts }, apns: variant.apns ?? profile.apns } : profile;
  const name = (x: string): string => NAMES[platform](x);
  return {
    side: {
      platform, version: await versionOf(platform, entry),
      phone: id === undefined ? { id: "", name: EVERY[platform] } : { id, name: name(id) },
      phones: ids.map((x) => ({ id: x, name: name(x) })),
      states: group.states, spread: spreadOf(groups, name),
    },
    profile: read,
  };
}

/** The Overview's iOS and Android section; null for a page with one platform, or before the index has states. */
export async function getPair(kind: Kind, name: string, iphone?: string, pixel?: string): Promise<Pair | null> {
  const page = await pageOf(kind, name);
  const { ios, android } = page.lines;
  const states = page.doc.states;
  if (!ios || !android || !states) return null;
  const [a, b] = await Promise.all([sideOf("ios", ios, states[ios] ?? [], iphone), sideOf("android", android, states[android] ?? [], pixel)]);
  if (!a || !b) return null;
  const rows = compareProfiles(a.profile, b.profile).groups.flatMap((g) => g.rows);
  return { ios: a.side, android: b.side, headline: HEADLINE.flatMap((id) => rows.filter((r) => r.id === id)) };
}

export interface CrossSide {
  readonly source: string;
  readonly entry: Version;
}

export interface CrossComparison {
  readonly a: CrossSide;
  readonly b: CrossSide;
  readonly comparison: ProfileComparison;
}

/** Two versions of any two sources, concept by concept: /compare across platforms. */
export async function getCrossComparison(
  a: { readonly platform: Platform; readonly source: string; readonly slug?: string | undefined },
  b: { readonly platform: Platform; readonly source: string; readonly slug?: string | undefined },
): Promise<CrossComparison> {
  const [ra, rb] = await Promise.all([resolve(a.source, a.slug), resolve(b.source, b.slug)]);
  const [pa, pb] = await Promise.all([ra.entry.sha ? profileOf(ra.entry.sha) : null, rb.entry.sha ? profileOf(rb.entry.sha) : null]);
  if (!pa || !pb) error(404, `${!pa ? a.source : b.source} has no normalised settings at that version yet.`);
  const [ea, eb] = await Promise.all([versionOf(a.platform, ra.entry), versionOf(b.platform, rb.entry)]);
  return { a: { source: a.source, entry: ea }, b: { source: b.source, entry: eb }, comparison: compareProfiles(pa, pb) };
}
