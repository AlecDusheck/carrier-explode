/** valibot schemas for the stored records this package defines and the JSON the index's rows hold; each `satisfies` its type, so drift fails to compile. */

import * as v from "valibot";

import {
  APN_AUTHS, APN_TYPES, CERTAINTIES, FEATURE_STATES, FIDELITIES, IP_PROTOCOLS, MODEM_VENDORS, MODEM_SCOPES, parseSourceKey, PLATFORMS, PROFILE_SCHEMA, SOURCE_KINDS,
  type AndroidModem, type AndroidRelease, type AppleRelease, type ApplePlatform, type BandCombination, type Carrier, type CarrierModem, type CountrySummary,
  type ModemConfig, type ModemValue, type Named, type OtaFile, type Platform, type Profile, type Release, type ReleaseChange, type ReleaseSummary, type SourceKey,
  type TimelineEntry,
} from "../types.ts";
import { imageModemSchema, jsonSchema, sha256Schema, sourceKeySchema } from "./values.ts";

const str = v.string();
const opt = <S extends v.GenericSchema>(s: S): v.ExactOptionalSchema<S, undefined> => v.exactOptional(s);
const nonEmpty = <S extends v.GenericSchema>(s: S): v.TupleWithRestSchema<[S], S, undefined> => v.tupleWithRest([s], s);

/** A key's platform, when it is a sourceKey. */
const platformOf = (k: string): Platform | undefined => parseSourceKey(k)?.platform;

/** A record keyed by sourceKeys of `platform` (any platform when omitted). */
const bySource = <S extends v.GenericSchema>(value: S, platform?: Platform) =>
  v.pipe(
    v.record(str, value),
    v.check((r) => Object.keys(r).every((k) => {
      const p = platformOf(k);
      return p !== undefined && (platform === undefined || p === platform);
    }), "expected sourceKeys"),
  );
const appleKey = v.custom<SourceKey<ApplePlatform>>(
  (s) => typeof s === "string" && platformOf(s) !== undefined && platformOf(s) !== "android", "expected an Apple sourceKey",
);

const digestsSchema = v.object({ sha1: opt(str), sha384: opt(str) });

export const otaFilesSchema = v.array(v.object({
  url: str,
  version: str,
  published: opt(str),
  digests: digestsSchema,
  sha: str,
  cid: str,
  listings: nonEmpty(v.object({
    source: appleKey,
    os: v.nullable(str),
    model: opt(str),
    firstSeenAt: str,
    lastSeenAt: str,
    live: v.boolean(),
  })),
}) satisfies v.GenericSchema<unknown, OtaFile>);

const header = { id: str, version: str, released: opt(str), devices: v.array(str), extractedAt: str };
const appleHeader = { ...header, platform: v.literal("ios"), label: str, prerelease: v.boolean() };
const androidHeader = { ...header, platform: v.literal("android"), patch: str };
const artifact = { sha: str, version: str, size: v.number() };

export const androidModemSchema = v.object({
  family: v.picklist(MODEM_VENDORS),
  firmware: str,
  devices: v.array(str),
  configs: v.record(str, str),
}) satisfies v.GenericSchema<unknown, AndroidModem>;

const appleReleaseSchema = v.object({
  ...appleHeader,
  sources: bySource(v.object({ ...artifact, cid: str }), "ios"),
  modems: v.array(imageModemSchema),
}) satisfies v.GenericSchema<unknown, AppleRelease>;

const androidReleaseSchema = v.object({
  ...androidHeader,
  sources: bySource(v.array(v.object({ ...artifact, devices: v.array(str) })), "android"),
  carrierList: str,
  modems: v.array(androidModemSchema),
}) satisfies v.GenericSchema<unknown, AndroidRelease>;

export const releaseSchema = v.variant("platform", [appleReleaseSchema, androidReleaseSchema]) satisfies v.GenericSchema<unknown, Release>;

/** A code and the name pages show for it. */
const named = <C extends string>(code: v.GenericSchema<unknown, C>): v.GenericSchema<unknown, Named<C>> => v.object({ code, name: str });

/** The index's row of a release: its header and what it carries, counted. */
const summarised = { sourceCount: v.number(), modemFamilies: v.array(named(str)) };
export const releaseSummarySchema = v.variant("platform", [
  v.object({ ...appleHeader, ...summarised }),
  v.object({ ...androidHeader, ...summarised }),
]) satisfies v.GenericSchema<unknown, ReleaseSummary>;

const simMatcherSchema = v.object({
  mccmnc: str, gid1: opt(str), gid2: opt(str), spn: opt(str), imsiPrefix: opt(str), iccidPrefix: opt(str),
});

const apnSchema = v.object({
  apn: str,
  label: opt(str),
  types: v.array(v.picklist(APN_TYPES)),
  protocol: opt(v.picklist(IP_PROTOCOLS)),
  roamingProtocol: opt(v.picklist(IP_PROTOCOLS)),
  auth: opt(v.picklist(APN_AUTHS)),
  user: opt(str),
  hasPassword: v.boolean(),
  proxy: opt(str),
  port: opt(str),
  mmsc: opt(str),
  mmsProxy: opt(str),
  mmsPort: opt(str),
  mtu: opt(v.number()),
  bearers: opt(v.array(str)),
  path: str,
});

const reading = { because: v.array(v.object({ path: str, value: jsonSchema })), fidelity: v.picklist(FIDELITIES) };

const conceptValueSchema = v.variant("kind", [
  v.object({ kind: v.literal("state"), state: v.picklist(FEATURE_STATES), ...reading }),
  v.object({ kind: v.literal("value"), value: jsonSchema, ...reading }),
  v.object({ kind: v.literal("unset") }),
]);

export const profileSchema = v.object({
  schema: v.literal(PROFILE_SCHEMA),
  source: v.object({ platform: v.picklist(PLATFORMS), kind: v.picklist(SOURCE_KINDS), name: str }),
  sha: str,
  identity: v.object({ display: opt(str), iso: v.array(str), sims: v.array(simMatcherSchema) }),
  apns: v.array(apnSchema),
  concepts: v.record(str, conceptValueSchema),
  raw: v.record(str, jsonSchema),
  variants: v.array(v.object({
    id: str,
    when: v.variant("kind", [
      v.object({ kind: v.literal("sim"), sims: v.array(simMatcherSchema) }),
      v.object({ kind: v.literal("device"), devices: v.array(str) }),
    ]),
    concepts: v.record(str, conceptValueSchema),
    apns: v.array(apnSchema),
  })),
}) satisfies v.GenericSchema<unknown, Profile>;

const modemValueSchema: v.GenericSchema<ModemValue> = v.lazy(() => v.variant("kind", [
  v.object({ kind: v.literal("number"), value: v.number() }),
  v.object({ kind: v.picklist(["text", "xml"]), value: str }),
  v.object({ kind: v.literal("bytes"), hex: v.pipe(str, v.regex(/^(?:[0-9a-f]{2})*$/)) }),
  v.object({ kind: v.literal("flags"), values: v.array(v.number()) }),
  v.object({ kind: v.literal("list"), values: v.array(modemValueSchema) }),
  v.object({ kind: v.literal("fields"), fields: v.record(str, modemValueSchema) }),
]));

export const modemConfigSchema = v.object({
  schema: v.literal(PROFILE_SCHEMA),
  family: v.picklist(MODEM_VENDORS),
  sha: str,
  label: str,
  scope: v.picklist(MODEM_SCOPES),
  selection: v.array(simMatcherSchema),
  facts: v.array(v.object({ label: str, value: str })),
  items: v.array(v.object({
    id: str, name: v.nullable(str), description: v.nullable(str), value: modemValueSchema, label: v.nullable(str), certainty: v.picklist(CERTAINTIES),
  })),
  base: v.nullable(sha256Schema),
  combos: v.array(v.object({ key: sha256Schema, sources: v.array(str), count: v.number() })),
  errors: v.array(str),
}) satisfies v.GenericSchema<unknown, ModemConfig>;

/** keys.combos: one stored list of band combinations. */
export const bandCombinationsSchema = v.array(v.array(v.object({
  band: str, dl: str, ul: opt(str), dlLayers: opt(v.number()), bandwidthMhz: opt(v.number()), scsKhz: opt(v.number()),
}))) satisfies v.GenericSchema<unknown, readonly BandCombination[]>;

const copySchema = v.variant("kind", [
  v.object({ kind: v.literal("image"), releases: v.array(str), sha: str }),
  v.object({ kind: v.literal("ota"), os: v.array(str), url: str, published: opt(str), digests: digestsSchema }),
]);

/** One version on a source's line, as the index's timeline holds it. */
export const timelineEntrySchema = v.object({
  slug: str, version: str, sha: str, copies: nonEmpty(copySchema), beta: v.boolean(), changed: v.boolean(),
}) satisfies v.GenericSchema<unknown, TimelineEntry>;

const releasedEntrySchema = v.object({ line: v.nullable(str), slug: str, version: str });

export const releaseChangeSchema = v.variant("kind", [
  v.object({ source: sourceKeySchema, kind: v.literal("added"), to: releasedEntrySchema }),
  v.object({ source: sourceKeySchema, kind: v.literal("removed"), from: releasedEntrySchema }),
  v.object({ source: sourceKeySchema, kind: v.literal("changed"), from: releasedEntrySchema, to: releasedEntrySchema }),
]) satisfies v.GenericSchema<unknown, ReleaseChange>;

const between = v.tuple([sourceKeySchema, sourceKeySchema]);

export const carrierSchema = v.object({
  id: str,
  name: str,
  iso: opt(str),
  members: v.array(sourceKeySchema),
  sims: v.array(simMatcherSchema),
  links: v.array(v.variant("kind", [
    v.object({ kind: v.literal("sims"), between, shared: v.array(str) }),
    v.object({ kind: v.literal("manual"), between }),
  ])),
}) satisfies v.GenericSchema<unknown, Carrier>;

export const carrierModemSchema = v.object({
  family: named(v.picklist(MODEM_VENDORS)), release: str, firmware: str, devices: v.array(str), label: str, sha: str,
}) satisfies v.GenericSchema<unknown, CarrierModem>;

export const countrySummarySchema = v.object({
  iso: str, name: str, sources: v.array(sourceKeySchema), carriers: v.array(str),
}) satisfies v.GenericSchema<unknown, CountrySummary>;
