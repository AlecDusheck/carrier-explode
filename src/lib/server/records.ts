/** Valibot schemas for the R2 records the site reads, each typed against its contract so a drift fails the type check. */

import * as v from "valibot";
import type {
  AndroidArtifact, AndroidRelease, Apn, AppleArtifact, AppleRelease, Archive, Carrier, CarrierDoc, CarrierLink, ConceptValue,
  DeviceStates, Digest, FeatureState, ImageModem, Json, LegacyRoute, Platform, Profile, ProfileVariant, Release,
  SimMatcher, SourceRef, Timeline, TimelineCopy, TimelineEntry,
} from "#lib/schema/types.ts";
import { PLATFORMS, SOURCE_KINDS } from "#lib/schema/types.ts";
import type { CarrierSummary, CountrySummary, ReleaseSummary } from "#lib/storage/keys.ts";

type Schema<T> = v.GenericSchema<unknown, T>;

const str = v.string();
const strs = v.array(str);
const opt = <S extends v.GenericSchema>(s: S): v.ExactOptionalSchema<S, undefined> => v.exactOptional(s);

const platform: Schema<Platform> = v.picklist(PLATFORMS);
const applePlatform: Schema<Exclude<Platform, "android">> = v.picklist(["ios", "ipados", "watchos"]);

export const json: Schema<Json> = v.lazy(() =>
  v.union([v.null(), v.boolean(), v.number(), v.string(), v.array(json), v.record(v.string(), json)]));

const sourceRef: Schema<SourceRef> = v.object({ platform, kind: v.picklist(SOURCE_KINDS), name: str });

const sim: Schema<SimMatcher> = v.object({
  mccmnc: str, gid1: opt(str), gid2: opt(str), spn: opt(str), imsiPrefix: opt(str), iccidPrefix: opt(str),
});

const ipProtocol = v.picklist(["ip", "ipv6", "ipv4v6", "ppp"]);
const apnTypes = ["default", "mms", "supl", "dun", "hipri", "fota", "ims", "cbs", "ia", "emergency", "xcap", "ut", "rcs", "vsim", "bip", "enterprise", "all"] as const;
const apn: Schema<Apn> = v.object({
  apn: str,
  label: opt(str),
  types: v.array(v.picklist(apnTypes)),
  protocol: opt(ipProtocol),
  roamingProtocol: opt(ipProtocol),
  auth: opt(v.picklist(["none", "pap", "chap", "pap_or_chap"])),
  user: opt(str),
  hasPassword: v.boolean(),
  proxy: opt(str),
  port: opt(str),
  mmsc: opt(str),
  mmsProxy: opt(str),
  mmsPort: opt(str),
  mtu: opt(v.number()),
  bearers: opt(strs),
  path: str,
});

const featureState: Schema<FeatureState> = v.picklist(["on", "available", "no"]);
const because = v.array(v.object({ path: str, value: json }));
const fidelity = v.picklist(["exact", "derived", "approx"]);
const conceptValue: Schema<ConceptValue> = v.variant("kind", [
  v.object({ kind: v.literal("state"), state: featureState, because, fidelity }),
  v.object({ kind: v.literal("value"), value: json, because, fidelity }),
  v.object({ kind: v.literal("unset") }),
]);
const concepts = v.record(v.string(), conceptValue);

const variant: Schema<ProfileVariant> = v.object({
  id: str,
  label: str,
  when: v.variant("by", [v.object({ by: v.literal("sim"), sims: v.array(sim) }), v.object({ by: v.literal("device"), devices: strs })]),
  concepts,
  apns: v.array(apn),
});

export const profile: Schema<Profile> = v.object({
  schema: v.literal(1),
  source: sourceRef,
  sha: str,
  version: str,
  identity: v.object({ display: opt(str), iso: strs, sims: v.array(sim) }),
  apns: v.array(apn),
  concepts,
  raw: v.record(v.string(), json),
  variants: v.array(variant),
});

const link: Schema<CarrierLink> = v.variant("reason", [
  v.object({ source: str, reason: v.literal("sims"), shared: strs }),
  v.object({ source: str, reason: v.literal("manual") }),
]);
const carrier: Schema<Carrier> = v.object({ id: str, name: str, iso: opt(str), members: v.array(sourceRef), sims: v.array(sim), links: v.array(link) });

const digest: Schema<Digest> = v.object({ algorithm: v.picklist(["sha1", "sha384"]), hex: str });
const archive: Schema<Archive> = v.variant("state", [
  v.object({ state: v.literal("archived"), sha: str, cid: str }),
  v.object({ state: v.literal("pending") }),
  v.object({ state: v.literal("failed"), error: str }),
]);
const copy: Schema<TimelineCopy> = v.variant("via", [
  v.object({ via: v.literal("image"), releases: strs, sha: str, cid: opt(str) }),
  v.object({ via: v.literal("ota"), os: strs, url: str, published: opt(str), digest: opt(digest), archive }),
]);
const entry: Schema<TimelineEntry> = v.object({
  slug: str, version: str, copies: v.tupleWithRest([copy], copy), beta: v.boolean(), changed: v.boolean(),
});
const entries = v.array(entry);
const timeline: Schema<Timeline> = v.variant("family", [
  v.object({ family: v.literal("apple"), entries, models: v.record(v.string(), entries) }),
  v.object({ family: v.literal("android"), devices: v.record(v.string(), entries), canonical: v.record(v.string(), str) }),
]);
const deviceStates: Schema<DeviceStates> = v.object({
  devices: v.union([strs, v.literal("rest")]), slug: str, line: opt(str), states: v.record(v.string(), featureState),
});

export const carrierDoc: Schema<CarrierDoc> = v.object({
  carrier,
  timelines: v.record(v.string(), timeline),
  states: v.record(v.string(), v.array(deviceStates)),
});

export const carrierSummaries: Schema<CarrierSummary[]> = v.array(v.object({
  id: str, name: str, iso: opt(str), platforms: v.array(platform), updated: opt(str), members: strs,
}));

export const countrySummaries: Schema<CountrySummary[]> = v.array(v.object({ iso: str, name: str, countryBundles: strs, carriers: strs }));

const headerBase = { id: str, version: str, released: opt(str), prerelease: v.boolean(), devices: strs, extractedAt: str };
const appleHeader = { ...headerBase, platform: applePlatform };
const androidHeader = { ...headerBase, platform: v.literal("android"), patch: str };

export const releaseSummaries: Schema<ReleaseSummary[]> = v.array(v.variant("platform", [
  v.object({ ...appleHeader, sourceCount: v.number() }),
  v.object({ ...androidHeader, sourceCount: v.number() }),
]));

const imageModem: Schema<ImageModem> = v.object({
  family: str,
  devices: strs,
  package: v.object({ sha: str, size: v.number(), name: str, crc32: str, kind: v.picklist(["bbfw", "ftab"]) }),
});
const appleArtifact: Schema<AppleArtifact> = v.object({ sha: str, version: str, size: v.number(), cid: str });
const androidArtifact: Schema<AndroidArtifact> = v.object({ sha: str, version: str, size: v.number(), devices: strs });
const appleRelease: Schema<AppleRelease> = v.object({ ...appleHeader, sources: v.record(v.string(), appleArtifact), modems: v.array(imageModem) });
const androidRelease: Schema<AndroidRelease> = v.object({ ...androidHeader, sources: v.record(v.string(), v.array(androidArtifact)), carrierList: str });

export const release: Schema<Release> = v.union([appleRelease, androidRelease]);

/** index/sources.json: sourceKey -> carrier id. */
export const sourceIndex: Schema<Record<string, string>> = v.record(v.string(), v.string());

export const legacyRoutes: Schema<LegacyRoute[]> = v.array(v.object({ from: str, to: str }));
