/**
 * Valibot schemas for every record the site reads out of R2. Each is typed
 * against the contract (src/lib/schema/types.ts, src/lib/storage/keys.ts), so a
 * contract change that the schemas miss fails the type check, and a record
 * that does not match its contract fails loudly at read time instead of
 * somewhere deep in a page.
 */

import * as v from "valibot";
import type { ModemKind } from "#lib/decode/index.ts";
import type {
  Apn, ApnAuth, ApnType, Carrier, CarrierDoc, ConceptValue, DeviceStates, FeatureState, IpProtocol, Json, NativeRef, Platform,
  Profile, ProfileVariant, Release, ReleaseSource, SimMatcher, SourceRef, TimelineEntry,
} from "#lib/schema/types.ts";
import type { CarrierSummary, CountrySummary, ReleaseSummary } from "#lib/storage/keys.ts";

const str = v.string();
const strs = v.array(v.string());
const opt = <S extends v.GenericSchema>(s: S): v.ExactOptionalSchema<S, undefined> => v.exactOptional(s);

export const platform: v.GenericSchema<Platform> = v.picklist(["ios", "android"]);

export const json: v.GenericSchema<Json> = v.lazy(() =>
  v.union([v.null(), v.boolean(), v.number(), v.string(), v.array(json), v.record(v.string(), json)]));

const sourceRef: v.GenericSchema<SourceRef> = v.object({
  platform,
  kind: v.picklist(["carrier", "country", "default"]),
  name: str,
  family: opt(v.literal("Watch")),
});

const sim: v.GenericSchema<SimMatcher> = v.object({
  mccmnc: str, gid1: opt(str), gid2: opt(str), spn: opt(str), imsiPrefix: opt(str), iccidPrefix: opt(str),
});

const ipProtocol: v.GenericSchema<IpProtocol> = v.picklist(["ip", "ipv6", "ipv4v6", "ppp"]);
const apnType: v.GenericSchema<ApnType> = v.picklist([
  "default", "mms", "supl", "dun", "hipri", "fota", "ims", "cbs", "ia", "emergency",
  "xcap", "ut", "rcs", "vsim", "bip", "enterprise", "all",
]);
const apnAuth: v.GenericSchema<ApnAuth> = v.picklist(["none", "pap", "chap", "pap_or_chap"]);

const apn: v.GenericSchema<Apn> = v.object({
  apn: str, label: opt(str), types: v.array(apnType), protocol: opt(ipProtocol), roamingProtocol: opt(ipProtocol),
  auth: opt(apnAuth), user: opt(str), hasPassword: opt(v.boolean()), proxy: opt(str), port: opt(str), mmsc: opt(str),
  mmsProxy: opt(str), mmsPort: opt(str), mtu: opt(v.number()), bearers: opt(strs), path: str,
});

const featureState: v.GenericSchema<FeatureState> = v.picklist(["on", "available", "no"]);
const nativeRef: v.GenericSchema<NativeRef> = v.object({ path: str, value: json });
const conceptValue: v.GenericSchema<ConceptValue> = v.object({
  value: json,
  state: opt(featureState),
  because: v.array(nativeRef),
  fidelity: opt(v.picklist(["exact", "derived", "approx"])),
});
const concepts = v.record(v.string(), conceptValue);

const variant: v.GenericSchema<ProfileVariant> = v.object({
  id: str,
  label: str,
  when: v.object({ sims: opt(v.array(sim)), devices: opt(strs) }),
  concepts,
  apns: opt(v.array(apn)),
});

export const profile: v.GenericSchema<Profile> = v.object({
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

const carrier: v.GenericSchema<Carrier> = v.object({
  slug: str,
  name: str,
  iso: opt(str),
  members: v.array(sourceRef),
  sims: v.array(sim),
  links: v.array(v.object({ source: str, reason: v.picklist(["manual", "sims"]), shared: opt(strs) })),
});

const timelineEntry: v.GenericSchema<TimelineEntry> = v.object({
  slug: str,
  via: v.picklist(["image", "ota"]),
  version: str,
  releases: strs,
  sha: opt(str),
  url: opt(str),
  sha1: opt(str),
  sha384: opt(str),
  cid: opt(str),
  productType: opt(str),
  devices: opt(strs),
  beta: opt(v.boolean()),
  changed: v.boolean(),
});

const deviceStates: v.GenericSchema<DeviceStates> = v.object({
  devices: opt(strs),
  slug: str,
  states: v.record(v.string(), featureState),
});

export const carrierDoc: v.GenericSchema<CarrierDoc> = v.object({
  carrier,
  timelines: v.record(v.string(), v.array(timelineEntry)),
  states: opt(v.record(v.string(), v.array(deviceStates))),
});

export const carrierSummaries: v.GenericSchema<CarrierSummary[]> = v.array(v.object({
  slug: str, name: str, iso: opt(str), platforms: v.array(platform), updated: opt(str), members: strs,
}));

export const countrySummaries: v.GenericSchema<CountrySummary[]> = v.array(v.object({
  iso: str, name: str, countryBundles: strs, carriers: strs,
}));

export const releaseSummaries: v.GenericSchema<ReleaseSummary[]> = v.array(v.object({
  platform, id: str, version: str, patch: opt(str), released: opt(str), prerelease: opt(v.boolean()), devices: strs,
  sources: v.number(),
}));

/** index/sources.json: sourceKey -> carrier slug. */
export const sourceSlugs: v.GenericSchema<Record<string, string>> = v.record(v.string(), v.string());

const releaseSource: v.GenericSchema<ReleaseSource> = v.object({ sha: str, version: str, size: v.number(), cid: opt(str), devices: opt(strs) });

export const release: v.GenericSchema<Release> = v.object({
  platform, id: str, version: str, patch: opt(str), released: opt(str), prerelease: opt(v.boolean()), devices: strs,
  extractedAt: str, sources: v.record(v.string(), v.array(releaseSource)), carrierList: opt(str), modems: opt(v.array(v.unknown())),
});

/**
 * One iOS modem package of a release: Release.modems keeps the v1 image index
 * shape (scripts/modems.py), which the contract leaves as unknown[].
 */
export interface ImageModem {
  readonly family: string;
  readonly package: { readonly id: string; readonly size: number; readonly name: string; readonly crc32: string; readonly kind: ModemKind };
  readonly devices: readonly string[];
}

export const imageModem: v.GenericSchema<ImageModem> = v.object({
  family: str,
  package: v.object({ id: str, size: v.number(), name: str, crc32: str, kind: v.picklist(["bbfw", "ftab"]) }),
  devices: strs,
});
