/**
 * What the API answers, documented in the OpenAPI document by the JSON Schema of each shape's valibot contract: the
 * stored records' own (@carrier-explode/schema/records), and the API's projections of them below. Each is typed by its
 * TypeScript type, which the contract `satisfies`.
 */

import { z } from "@hono/zod-openapi";
import { toJsonSchema, type JsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { ListedCarrier } from "@carrier-explode/db/d1";
import {
  androidModemSchema, bandCombinationsSchema, carrierModemSchema, carrierSchema, countrySummarySchema, imageModemSchema, jsonSchema, modemConfigSchema,
  profileSchema, releaseChangeSchema, releaseSummarySchema, sourceKeySchema, timelineEntrySchema,
} from "@carrier-explode/schema/records";
import {
  DECODER_FAMILIES, FEATURE_SLUGS, FEATURE_STATES, KIND_SEGMENTS, PLATFORMS, RELEASE_PLATFORMS,
  type AndroidModem, type BandCombination, type Carrier, type CarrierModem, type CountrySummary, type DecoderFamily, type FeatureSlug, type FeatureState,
  type ImageModem, type Json, type KindSegment, type ModemConfig, type Phone, type Platform, type Profile, type ReleaseChange, type ReleaseSummary, type SourceKey,
  type TimelineEntry,
} from "@carrier-explode/schema";
import type { Page } from "./page.ts";

/**
 * Each documented shape's JSON Schema by component name, with its recursive parts (a JSON value, a modem value) as
 * components of their own: /openapi.json puts them in the document in place of the empty ones zod registers.
 */
const records = new Map<string, JsonSchema | boolean>();
export const RECORD_SCHEMAS: ReadonlyMap<string, JsonSchema | boolean> = records;

/** `T`, documented as its contract's JSON Schema. Every v.custom in the contracts is a string: a source key. */
function documented<T>(name: string, schema: v.GenericSchema<unknown, T>): z.ZodCustom<T, T> {
  const { $defs = {}, ...own } = toJsonSchema(schema, {
    target: "draft-2020-12",
    errorMode: "ignore",
    overrideSchema: ({ valibotSchema }) => (valibotSchema.type === "custom" ? { type: "string" } : undefined),
    overrideRef: ({ referenceId }) => `#/components/schemas/${name}.${referenceId}`,
  });
  records.set(name, { ...own, $schema: undefined });
  for (const [id, part] of Object.entries($defs)) records.set(`${name}.${id}`, part);
  // zod-to-openapi needs a type to register a custom schema; the document's schema is RECORD_SCHEMAS's.
  return z.custom<T>().openapi(name, { type: "object" });
}

const str = v.string();
const nullable = <S extends v.GenericSchema>(s: S): v.NullableSchema<S, undefined> => v.nullable(s);

const nextSchema = nullable(v.object({ cursor: str, url: str }));

/** A page of `item`s, documented under `name`. */
function pageOf<T>(name: string, item: v.GenericSchema<unknown, T>): z.ZodCustom<Page<T>, Page<T>> {
  return documented<Page<T>>(name, v.object({ items: v.array(item), next: nextSchema }));
}

export interface PlatformInfo {
  readonly platform: Platform;
  /** The decoder its settings files go through: an iPad's and a Watch's bundles are Apple's. */
  readonly family: DecoderFamily;
  readonly kinds: readonly KindSegment[];
  /** Whether its OS images are read, so it has builds and phones. */
  readonly builds: boolean;
}

export const platformsSchema = documented<readonly PlatformInfo[]>("Platforms", v.array(v.object({
  platform: v.picklist(PLATFORMS), family: v.picklist(DECODER_FAMILIES), kinds: v.array(v.picklist(KIND_SEGMENTS)), builds: v.boolean(),
})));

export interface Feature {
  readonly slug: FeatureSlug;
  readonly name: string;
  readonly description: string;
  /** A phone without a 5G radio cannot use it, whatever the carrier sets. */
  readonly needs5G: boolean;
}

export const featuresSchema = documented<readonly Feature[]>("Features", v.array(v.object({
  slug: v.picklist(FEATURE_SLUGS), name: str, description: str, needs5G: v.boolean(),
})));

/** A carrier as lists name it. */
const listedCarrierSchema = v.object({
  id: str, name: str, iso: nullable(str), members: v.array(sourceKeySchema), updated: nullable(str),
}) satisfies v.GenericSchema<unknown, ListedCarrier>;

export const carrierPageSchema = pageOf<ListedCarrier>("CarrierPage", listedCarrierSchema);

export interface CarrierDetail {
  readonly carrier: Carrier;
  /** Android modem configurations the carrier's SIMs select, per group of Pixels. */
  readonly modems: readonly CarrierModem[];
}

export const carrierDetailSchema = documented<CarrierDetail>("Carrier", v.object({ carrier: carrierSchema, modems: v.array(carrierModemSchema) }));

export const countryPageSchema = pageOf<CountrySummary>("CountryPage", countrySummarySchema);
export const countrySchema = documented<CountrySummary>("Country", countrySummarySchema);

export interface SourceSummary {
  readonly key: SourceKey;
  readonly name: string;
  readonly carrier: Pick<ListedCarrier, "id" | "name" | "iso">;
  /** YYYY-MM-DD: the newest change of its carrier, any platform. */
  readonly updated: string | null;
}

const carrierRefSchema = v.object({ id: str, name: str, iso: nullable(str) });

export const sourcePageSchema = pageOf<SourceSummary>("SourcePage", v.object({
  key: sourceKeySchema, name: str, carrier: carrierRefSchema, updated: nullable(str),
}));

export interface LineSummary {
  /** A Pixel's codename, or an Apple model's product type; null for Apple's main line. */
  readonly line: string | null;
  readonly versions: number;
  /** The slug of its newest non-beta version. */
  readonly head: string | null;
}

export interface SourceDetail {
  readonly key: SourceKey;
  readonly carrier: Pick<ListedCarrier, "id" | "name" | "iso">;
  readonly lines: readonly LineSummary[];
}

export const sourceSchema = documented<SourceDetail>("Source", v.object({
  key: sourceKeySchema,
  carrier: carrierRefSchema,
  lines: v.array(v.object({ line: nullable(str), versions: v.number(), head: nullable(str) })),
}));

export const versionPageSchema = pageOf<TimelineEntry>("VersionPage", timelineEntrySchema);

/** A version's decoded settings in the platform-neutral model: its identity, APNs, concepts and variants. */
export type NeutralProfile = Omit<Profile, "raw">;

export interface VersionDetail {
  readonly key: SourceKey;
  readonly line: string | null;
  readonly entry: TimelineEntry;
  /** The slug of the version before it on its line. */
  readonly previous: string | null;
  readonly profile: NeutralProfile;
}

export const versionSchema = documented<VersionDetail>("Version", v.object({
  key: sourceKeySchema, line: nullable(str), entry: timelineEntrySchema, previous: nullable(str), profile: v.omit(profileSchema, ["raw"]),
}));

export interface VersionSettings {
  readonly key: SourceKey;
  readonly line: string | null;
  readonly slug: string;
  /** Every native setting, decoded: `<file>:<key path>` on Apple, `config:<key>` and `apns[<i>].<field>` on Android. */
  readonly settings: Readonly<Record<string, Json>>;
}

export const settingsSchema = documented<VersionSettings>("Settings", v.object({
  key: sourceKeySchema, line: nullable(str), slug: str, settings: v.record(str, jsonSchema),
}));

export const carrierModemsSchema = documented<readonly CarrierModem[]>("CarrierModems", v.array(carrierModemSchema));
export const modemConfigRecordSchema = documented<ModemConfig>("ModemConfig", modemConfigSchema);
export const combosSchema = documented<readonly BandCombination[]>("BandCombinations", bandCombinationsSchema);

export const buildPageSchema = pageOf<ReleaseSummary>("BuildPage", releaseSummarySchema);
export const buildSchema = documented<ReleaseSummary>("Build", releaseSummarySchema);
export const changePageSchema = pageOf<ReleaseChange>("ChangePage", releaseChangeSchema);

export type BuildModems =
  | { readonly platform: "ios"; readonly modems: readonly ImageModem[] }
  | { readonly platform: "android"; readonly modems: readonly AndroidModem[] };

export const buildModemsSchema = documented<BuildModems>("BuildModems", v.variant("platform", [
  v.object({ platform: v.literal("ios"), modems: v.array(imageModemSchema) }),
  v.object({ platform: v.literal("android"), modems: v.array(androidModemSchema) }),
]));

export const phonePageSchema = pageOf<Phone>("PhonePage", v.object({ code: str, name: str, platform: v.picklist(RELEASE_PLATFORMS), has5G: v.boolean() }));

export interface SourceFeatures {
  readonly source: SourceKey;
  /** By feature slug; a feature the source leaves unset is absent. */
  readonly states: Readonly<Record<string, FeatureState>>;
}

export const featurePageSchema = pageOf<SourceFeatures>("PhoneFeaturePage", v.object({
  source: sourceKeySchema, states: v.record(str, v.picklist(FEATURE_STATES)),
}));
