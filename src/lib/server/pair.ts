/**
 * Apple against Android: the Overview's "iOS and Android" section, and /compare
 * when its two sides are on different platforms. Feature states come from the
 * index (CarrierDoc.states, per device group); everything else from the two
 * versions' Profiles (norm/v<N>/<sha>.json), compared by the schema's
 * compareProfiles.
 *
 * Both platforms decide per phone: an Apple bundle carries per-model override
 * files, and an Android build ships one file per group of Pixels. So a side is
 * read for one phone, the newest unless one is named, and a feature whose
 * answer differs between phones says so.
 */

import { error } from "@sveltejs/kit";
import { keys } from "#lib/storage/keys.ts";
import { compareProfiles, type ConceptRow, type ProfileComparison } from "#lib/schema/index.ts";
import { decoderFamily, sourceKey, type DeviceStates, type FeatureState, type Platform, type Profile, type SourceRef, type TimelineEntry } from "#lib/schema/types.ts";
import type { Version } from "#lib/types.ts";
import { perRequest } from "./cache";
import { locate, resolve, versionOf } from "./catalog";
import { DEVICES } from "./devices";
import { readJson } from "./store";
import * as records from "./records";

const profileOf = perRequest((sha: string) => readJson(keys.norm(sha), records.profile));

/** The Profile of a version: of its archived bytes, which every normalised version has. */
async function profileAt(e: TimelineEntry): Promise<Profile | null> {
  const sha = e.copies.flatMap((c) => c.sha ?? [])[0];
  return sha === undefined ? null : profileOf(sha);
}

export interface PhoneName {
  /** Apple product type or Pixel codename; "" for a side read for every device. */
  readonly id: string;
  readonly name: string;
}

/** What a side without per-device files is read for. */
const EVERY = { ios: "every iPhone", ipados: "every iPad", watchos: "every Apple Watch", android: "every Pixel" } as const satisfies Record<Platform, string>;

/** A feature whose answer differs between a source's devices: each answer and who gets it. */
export interface Spread {
  readonly state: FeatureState | "not set";
  readonly phones: readonly string[];
}

export interface PairSide {
  readonly source: SourceRef;
  /** The version the side was read at. */
  readonly version: Version;
  readonly phone: PhoneName;
  readonly phones: readonly PhoneName[];
  readonly states: Readonly<Record<string, FeatureState>>;
  /** Feature id -> answers per device, only where the devices disagree. */
  readonly spread: Readonly<Record<string, readonly Spread[]>>;
}

/** An Apple source against its carrier's Android source, whichever of the two the page is. */
export interface Pair {
  readonly apple: PairSide;
  readonly android: PairSide;
  /** A few concepts besides the features, Apple (a) against Android (b). */
  readonly headline: readonly ConceptRow[];
}

/** Concepts worth a line beside the features: the ones people ask a carrier about. */
const HEADLINE = ["nr-modes", "wfc-mode", "sms-over-ims", "mms-max-size", "apn-internet", "emergency-numbers"] as const;

function spreadOf(groups: readonly DeviceStates[], platform: Platform): Record<string, Spread[]> {
  const out: Record<string, Spread[]> = {};
  for (const f of new Set(groups.flatMap((g) => Object.keys(g.states)))) {
    const by = new Map<FeatureState | "not set", string[]>();
    for (const g of groups) {
      const state = g.states[f] ?? "not set";
      by.set(state, [...(by.get(state) ?? []), ...(g.devices?.map(DEVICES[platform].name) ?? [EVERY[platform]])]);
    }
    if (by.size > 1) out[f] = [...by].map(([state, phones]) => ({ state, phones }));
  }
  return out;
}

/**
 * A source read for one device: the group naming it, else the group for every
 * device no other group names. An Apple group is the bundle with that model's
 * override file on top (Profile.variants).
 */
async function sideOf(ref: SourceRef, groups: readonly DeviceStates[], wanted: string | undefined): Promise<{ side: PairSide; profile: Profile } | null> {
  const naming = DEVICES[ref.platform];
  const ids = [...new Set(groups.flatMap((g) => g.devices ?? []))].sort(naming.order);
  const id = wanted !== undefined && ids.includes(wanted) ? wanted : ids[0];
  const group = groups.find((g) => id !== undefined && g.devices?.includes(id)) ?? groups.find((g) => g.devices === undefined);
  if (!group) return null;
  const { entry } = await resolve(sourceKey(ref), group.slug);
  const profile = await profileAt(entry);
  if (!profile) return null;
  const variant = id === undefined ? undefined : profile.variants.find((v) => v.when.devices?.includes(id));
  const read = variant ? { ...profile, concepts: { ...profile.concepts, ...variant.concepts }, apns: variant.apns ?? profile.apns } : profile;
  return {
    side: {
      source: ref,
      version: await versionOf(ref.platform, entry),
      phone: id === undefined ? { id: "", name: EVERY[ref.platform] } : { id, name: naming.name(id) },
      phones: ids.map((x) => ({ id: x, name: naming.name(x) })),
      states: group.states,
      spread: spreadOf(groups, ref.platform),
    },
    profile: read,
  };
}

/** The carrier's member on the other decoder family: Android for an Apple source; iOS, then iPadOS, then watchOS for Android. */
function otherSide(members: readonly SourceRef[], ref: SourceRef): SourceRef | undefined {
  const wanted: readonly Platform[] = decoderFamily(ref.platform) === "apple" ? ["android"] : ["ios", "ipados", "watchos"];
  return wanted.flatMap((p) => members.filter((m) => m.platform === p && m.kind === ref.kind))[0];
}

/** The Overview's "iOS and Android" section; null for a source whose carrier is on one side only. */
export async function getPair(key: string, phones: { readonly apple?: string | undefined; readonly android?: string | undefined }): Promise<Pair | null> {
  const here = await locate(key);
  const there = otherSide(here.doc.carrier.members, here.ref);
  if (!there) return null;
  const [apple, android] = decoderFamily(here.ref.platform) === "apple" ? [here.ref, there] : [there, here.ref];
  const statesOf = (ref: SourceRef): readonly DeviceStates[] => here.doc.states[sourceKey(ref)] ?? [];
  const [a, b] = await Promise.all([sideOf(apple, statesOf(apple), phones.apple), sideOf(android, statesOf(android), phones.android)]);
  if (!a || !b) return null;
  const rows = compareProfiles(a.profile, b.profile).groups.flatMap((g) => g.rows);
  return { apple: a.side, android: b.side, headline: HEADLINE.flatMap((id) => rows.filter((r) => r.id === id)) };
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
  a: { readonly source: string; readonly slug?: string | undefined },
  b: { readonly source: string; readonly slug?: string | undefined },
): Promise<CrossComparison> {
  const [ra, rb] = await Promise.all([resolve(a.source, a.slug), resolve(b.source, b.slug)]);
  const [pa, pb] = await Promise.all([profileAt(ra.entry), profileAt(rb.entry)]);
  if (!pa || !pb) error(404, `${!pa ? a.source : b.source} has no normalised settings at that version yet.`);
  const [ea, eb] = await Promise.all([versionOf(ra.ref.platform, ra.entry), versionOf(rb.ref.platform, rb.entry)]);
  return { a: { source: a.source, entry: ea }, b: { source: b.source, entry: eb }, comparison: compareProfiles(pa, pb) };
}
