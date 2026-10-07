/**
 * What the API answers: each shape a valibot contract, typed by its output and documented in the OpenAPI document by its
 * JSON Schema. A route's handler must answer its contract, so the index's rows are checked against them where they are sent.
 */

import { z } from "@hono/zod-openapi";
import { toJsonSchema, type JsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import { RULE_VIAS } from "@carrier-explode/db";
import {
	CONCEPT_GROUPS,
	CONCEPT_UNITS,
	FEATURE_SLUGS,
	type ProfileComparison,
} from "@carrier-explode/schema";
import {
	bandCombinationsSchema,
	defaultedSchema,
	jsonSchema,
	modemConfigSchema,
	profileSchema,
	sha256Schema,
	sourceKeySchema,
} from "@carrier-explode/schema/records";
import {
	DECODER_FAMILIES,
	DEVICE_RELEASE_PLATFORMS,
	FEATURE_STATES,
	KIND_SEGMENTS,
	PLATFORMS,
	RELEASE_PLATFORMS,
	SOURCE_KINDS,
} from "@carrier-explode/schema/types";

/**
 * Each documented shape's JSON Schema by component name, with its recursive parts (a JSON value, a modem value) as
 * components of their own: /openapi.json puts them in the document in place of the empty ones zod registers.
 */
const records = new Map<string, JsonSchema | boolean>();
export const RECORD_SCHEMAS: ReadonlyMap<string, JsonSchema | boolean> = records;

/** A contract, documented as its JSON Schema. Every v.custom in the contracts is a string: a source key. */
function documented<S extends v.GenericSchema>(
	name: string,
	schema: S,
): z.ZodCustom<v.InferOutput<S>, v.InferOutput<S>> {
	const { $defs = {}, ...own } = toJsonSchema(schema, {
		target: "draft-2020-12",
		errorMode: "ignore",
		overrideSchema: ({ valibotSchema }) => (valibotSchema.type === "custom" ? { type: "string" } : undefined),
		overrideRef: ({ referenceId }) => `#/components/schemas/${name}.${referenceId}`,
	});
	records.set(name, { ...own, $schema: undefined });
	for (const [id, part] of Object.entries($defs)) records.set(`${name}.${id}`, part);
	// zod-to-openapi needs a type to register a custom schema; the document's schema is RECORD_SCHEMAS's.
	return z.custom<v.InferOutput<S>>().openapi(name, { type: "object" });
}

/** A contract for answers typed elsewhere, read-only (a schema function's): `schema` must answer `Out`. */
const documentedAs =
	<Out>() =>
	<S extends v.GenericSchema<unknown, Out>>(name: string, schema: S): z.ZodCustom<Out, Out> =>
		documented<v.GenericSchema<unknown, Out>>(name, schema);

const str = v.string();
const nullable = <S extends v.GenericSchema>(s: S): v.NullableSchema<S, undefined> => v.nullable(s);
/** Readonly, so the index's rows fit as they are. */
const list = <S extends v.GenericSchema>(
	item: S,
): v.SchemaWithPipe<readonly [v.ArraySchema<S, undefined>, v.ReadonlyAction<v.InferOutput<S>[]>]> =>
	v.pipe(v.array(item), v.readonly());

const next = nullable(v.object({ cursor: str, url: str }));

/** A page of `item`s, with `more` fields beside them. */
const page = <S extends v.GenericSchema, M extends v.ObjectEntries>(item: S, more: M) =>
	v.object({ ...more, items: list(item), next });

const pageOf = <S extends v.GenericSchema>(name: string, item: S) => documented(name, page(item, {}));

/** A list read whole. */
const itemsOf = <S extends v.GenericSchema>(name: string, item: S) =>
	documented(name, v.object({ items: list(item) }));

const platform = v.picklist(PLATFORMS);
const releasePlatform = v.picklist(RELEASE_PLATFORMS);

export const indexSchema = documented(
	"Index",
	v.object({
		openapi: str,
		docs: str,
		/** Each collection's URL template, with an example. */
		resources: list(v.object({ path: str, example: str, about: str })),
	}),
);

const platformInfoSchema = v.object({
	platform,
	/** The decoder its settings files go through: an iPad's and a Watch's bundles are Apple's. */
	family: v.picklist(DECODER_FAMILIES),
	kinds: list(v.picklist(KIND_SEGMENTS)),
	/** Whether its OS images are read, so it has builds and devices. */
	builds: v.boolean(),
});
export type PlatformInfo = v.InferOutput<typeof platformInfoSchema>;
export const platformsSchema = documented("Platforms", list(platformInfoSchema));

const conceptHeader = {
	id: str,
	group: v.picklist(CONCEPT_GROUPS),
	groupName: str,
	name: str,
	description: str,
};
const conceptSchema = v.variant("type", [
	v.object({
		...conceptHeader,
		/** A feature: a phone reads its state per carrier. */
		type: v.literal("state"),
		/** A phone without a 5G radio cannot use it, whatever the carrier sets. */
		needs5G: v.boolean(),
		/** Features it rides on: a carrier without them has none of it. */
		requires: list(str),
	}),
	v.object({ ...conceptHeader, type: v.literal("boolean") }),
	v.object({ ...conceptHeader, type: v.literal("number"), unit: v.picklist(CONCEPT_UNITS) }),
	v.object({ ...conceptHeader, type: v.literal("string") }),
	v.object({
		...conceptHeader,
		type: v.literal("list"),
		of: v.picklist(["string", "number"]),
		ordered: v.boolean(),
	}),
]);
export type ConceptInfo = v.InferOutput<typeof conceptSchema>;
export const conceptsSchema = documented("Concepts", list(conceptSchema));

const carrierRef = v.object({ id: str, name: str });
/** A source's carrier; null for a country bundle, and for a source not yet linked. */
const carrierRefSchema = nullable(carrierRef);

const deviceRef = v.object({ code: str, name: str, platform: releasePlatform });

const carrierSummary = {
	id: str,
	name: str,
	iso: nullable(str),
	platforms: list(platform),
	/** YYYY-MM-DD: the newest change of any of its sources. */
	updated: nullable(str),
};

export const carrierPageSchema = pageOf("CarrierPage", v.object(carrierSummary));

const headSchema = v.object({ line: str, slug: str, version: str });

export const carrierSchema = documented(
	"Carrier",
	v.object({
		...carrierSummary,
		/** By key. */
		sources: list(
			v.object({
				key: sourceKeySchema,
				platform,
				kind: v.picklist(SOURCE_KINDS),
				name: str,
				updated: nullable(str),
				/** The version a phone reads when none is named: its default line's newest non-beta. */
				head: headSchema,
			}),
		),
	}),
);

const statesSchema = v.record(str, v.picklist(FEATURE_STATES));
/**
 * By feature slug, each state the source leaves unset: the layer under it that decided it (a Pixel build's default.pb,
 * AOSP's defaults, a Galaxy's IMS service), and whether it decided all of the state or only what the source's own
 * settings leave open.
 */
const defaultsSchema = v.record(str, defaultedSchema);

export const carrierFeaturesSchema = itemsOf(
	"CarrierFeatures",
	v.object({ source: sourceKeySchema, device: deviceRef, states: statesSchema, defaults: defaultsSchema }),
);

/** A Profile's parts a request may select; `raw` is a version's settings. */
export const PROFILE_FIELDS = ["identity", "apns", "concepts", "variants"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

const { identity, apns, concepts, variants, source, sha } = profileSchema.entries;
const selectedProfile = v.object({
	source,
	sha,
	identity: v.optional(identity),
	apns: v.optional(apns),
	concepts: v.optional(concepts),
	variants: v.optional(variants),
});

export const carrierProfilesSchema = itemsOf(
	"CarrierProfiles",
	v.object({ source: sourceKeySchema, ...headSchema.entries, profile: selectedProfile }),
);

const carrierModemSchema = v.object({
	platform: releasePlatform,
	release: str,
	firmware: str,
	label: str,
	sha: sha256Schema,
	family: str,
	familyName: str,
	devices: list(str),
});

/** Per firmware, the configurations of its newest release that the carrier's SIMs select. */
export const carrierModemsSchema = itemsOf("CarrierModems", carrierModemSchema);

const countrySummarySchema = v.object({
	iso: str,
	carriers: v.number(),
	/** Its country bundles. */
	sources: list(sourceKeySchema),
});

export const countryPageSchema = pageOf("CountryPage", countrySummarySchema);

export const countrySchema = documented(
	"Country",
	v.object({ iso: str, sources: list(sourceKeySchema), carriers: list(v.object(carrierSummary)) }),
);

export const featureStatesSchema = documented(
	"FeatureStates",
	page(
		v.object({
			source: sourceKeySchema,
			carrier: carrierRefSchema,
			device: str,
			/** Null: the phone reads the source, and nothing in it or under it decides. */
			state: nullable(v.picklist(FEATURE_STATES)),
			defaulted: nullable(defaultedSchema),
		}),
		{
			feature: v.picklist(FEATURE_SLUGS),
			/** The phones the states are read on. */
			devices: list(deviceRef),
		},
	),
);

const deviceSchema = v.object({
	code: str,
	name: str,
	platform: releasePlatform,
	released: str,
	/** Apple's board configs, which bundles name per-phone override files by. */
	boards: list(str),
	/** Null when its newest build's settings don't say: unread, or no modem configurations. */
	has5g: nullable(v.boolean()),
});

export const devicePageSchema = pageOf("DevicePage", deviceSchema);

export const deviceDetailSchema = documented(
	"Device",
	v.object({
		...deviceSchema.entries,
		/** The newest build that lists it. */
		build: nullable(v.object({ id: str, version: str, released: nullable(str) })),
	}),
);

export const deviceFeaturesSchema = pageOf(
	"DeviceFeatures",
	v.object({ source: sourceKeySchema, states: statesSchema, defaults: defaultsSchema }),
);

export const simMatchesSchema = itemsOf(
	"SimMatches",
	v.object({
		source: sourceKeySchema,
		carrier: carrierRefSchema,
		/** The rule's key: `310260`, `310260|gid1=6D`, `iccid:8901260`. */
		rule: str,
		/** `claimed`: the source's own file names the rule; `routed`: its platform's routing (Apple's OTA manifest, a Pixel's carrier_list.pb) sends it the SIM. */
		via: v.picklist(RULE_VIAS),
	}),
);

const conceptValue = concepts.value;
const apn = apns.item;
const sides = <S extends v.GenericSchema>(s: S) => ({ a: s, b: s });

const comparisonEnd = v.object({ source: sourceKeySchema, ...headSchema.entries });

const conceptRowSchema = v.variant("status", [
	v.object({ id: str, status: v.picklist(["same", "different"]), ...sides(conceptValue) }),
	v.object({ id: str, status: v.literal("only-a"), a: conceptValue }),
	v.object({ id: str, status: v.literal("only-b"), b: conceptValue }),
]);

const apnRowSchema = v.variant("status", [
	v.object({
		apn: str,
		status: v.literal("matched"),
		...sides(apn),
		sameTypes: v.boolean(),
		differs: list(v.keyof(v.omit(apn, ["apn", "path"]))),
	}),
	v.object({ apn: str, status: v.literal("only-a"), a: apn }),
	v.object({ apn: str, status: v.literal("only-b"), b: apn }),
]);

const rawRowSchema = v.variant("status", [
	v.object({ path: str, status: v.literal("changed"), ...sides(jsonSchema) }),
	v.object({ path: str, status: v.literal("only-a"), a: jsonSchema }),
	v.object({ path: str, status: v.literal("only-b"), b: jsonSchema }),
]);

const comparisonCommon = {
	...sides(comparisonEnd),
	/** Concepts by group, in display order. */
	groups: list(v.object({ group: v.picklist(CONCEPT_GROUPS), rows: list(conceptRowSchema) })),
	apns: list(apnRowSchema),
};

type WithoutEnds<T> = T extends unknown ? Omit<T, "a" | "b"> : never;

/** compareProfiles' rows, with each side named by its version. */
export type Comparison = WithoutEnds<ProfileComparison> & {
	readonly a: v.InferOutput<typeof comparisonEnd>;
	readonly b: v.InferOutput<typeof comparisonEnd>;
};

export const comparisonSchema = documentedAs<Comparison>()(
	"Comparison",
	v.variant("sameFamily", [
		/** Native settings compare only within one decoder family. */
		v.object({ ...comparisonCommon, sameFamily: v.literal(true), raw: list(rawRowSchema) }),
		v.object({ ...comparisonCommon, sameFamily: v.literal(false) }),
	]),
);

const sourceSummary = {
	key: sourceKeySchema,
	name: str,
	carrier: carrierRefSchema,
	/** YYYY-MM-DD the source last changed; null when nothing dates it. */
	updated: nullable(str),
};
export const sourcePageSchema = pageOf("SourcePage", v.object(sourceSummary));

export const sourceSchema = documented(
	"Source",
	v.object({
		...sourceSummary,
		lines: list(
			v.object({
				/** A device's code, or empty for Apple's main line. The first is the default. */
				line: str,
				versions: v.number(),
				/** The slug of its newest non-beta version, else its newest. */
				head: str,
			}),
		),
		/** The SIM rules its head claims, and those its platform's routing sends it. */
		selectedBy: v.object({ claimed: list(str), routed: list(str) }),
		/** The base layer its newest phone reads it over (a Pixel build's default.pb); null without one. */
		base: nullable(v.object({ source: sourceKeySchema, line: str, slug: str, version: str })),
	}),
);

const timelineEntrySchema = v.object({
	line: str,
	slug: str,
	version: str,
	sha: str,
	beta: v.boolean(),
	changed: v.boolean(),
	day: nullable(str),
});

export const versionPageSchema = pageOf("VersionPage", timelineEntrySchema);

const shippedSchema = v.variant("kind", [
	/** In an OS image. */
	v.object({
		kind: v.literal("build"),
		platform: releasePlatform,
		id: str,
		version: str,
		released: nullable(str),
	}),
	/** A carrier update download: Apple's OTA manifest, or Google's Pixel carrier settings service. */
	v.object({
		kind: v.literal("ota"),
		url: str,
		version: str,
		published: nullable(str),
		/** The OS versions it is listed for. */
		os: list(str),
	}),
]);

export const versionSchema = documented(
	"Version",
	v.object({
		key: sourceKeySchema,
		line: str,
		entry: timelineEntrySchema,
		/** The slug of the version before it on its line. */
		previous: nullable(str),
		/** Every build and download that carried it on its line. */
		shipped: list(shippedSchema),
		/** Its decoded settings in the platform-neutral model, the fields asked for. */
		profile: selectedProfile,
	}),
);

export const settingsSchema = documented(
	"Settings",
	v.object({
		key: sourceKeySchema,
		line: str,
		slug: str,
		/** Every native setting, decoded: `<file>:<key path>` on Apple, `config:<key>` and `apns[<i>].<field>` on Android. */
		settings: v.record(str, jsonSchema),
	}),
);

export const modemConfigRecordSchema = documented("ModemConfig", modemConfigSchema);
export const combosSchema = documented("BandCombinations", bandCombinationsSchema);

const releaseHeader = {
	id: str,
	version: str,
	released: nullable(str),
	devices: list(str),
	sourceCount: v.number(),
};

const releaseSchema = v.variant("platform", [
	v.object({ ...releaseHeader, platform: v.literal("ios"), label: str, prerelease: v.boolean() }),
	v.object({ ...releaseHeader, platform: v.literal("android"), patch: str }),
	v.object({ ...releaseHeader, platform: v.literal("samsung") }),
]);

export type BuildHeader = v.InferOutput<typeof releaseSchema>;

export const buildPageSchema = pageOf("BuildPage", releaseSchema);
export const buildSchema = documented("Build", releaseSchema);

const changeEnd = v.object({ line: str, slug: str, version: str });
const changeSchema = v.variant("kind", [
	v.object({ source: sourceKeySchema, kind: v.literal("added"), to: changeEnd }),
	v.object({ source: sourceKeySchema, kind: v.literal("removed"), from: changeEnd }),
	v.object({
		source: sourceKeySchema,
		kind: v.literal("changed"),
		from: changeEnd,
		to: changeEnd,
		/** The comparison of the two versions. */
		compare: str,
	}),
]);

export const changePageSchema = pageOf("ChangePage", changeSchema);

const modem = { name: str, family: str, familyName: str, devices: list(str) };

const shippedModemsSchema = v.variant("platform", [
	/** An iOS image's baseband firmware packages. */
	v.object({ platform: v.literal("ios"), modems: list(v.object({ ...modem, package: sha256Schema })) }),
	/** A Pixel's or Galaxy's modem firmware and the carrier configurations it carries. */
	v.object({
		platform: v.picklist(DEVICE_RELEASE_PLATFORMS),
		modems: list(v.object({ ...modem, configs: list(v.object({ label: str, sha: sha256Schema })) })),
	}),
]);
export type ShippedModems = v.InferOutput<typeof shippedModemsSchema>;

export const buildModemsSchema = documented("BuildModems", shippedModemsSchema);

export const deviceModemsSchema = documented(
	"DeviceModems",
	v.intersect([v.object({ device: str, build: str }), shippedModemsSchema]),
);
