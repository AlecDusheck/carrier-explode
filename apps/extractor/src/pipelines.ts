/** The Workflows: one per pipeline, one instance per unit, named by the unit. */

import * as v from "valibot";

import { sha1Schema } from "@carrier-explode/schema/records";
import { RELEASE_PLATFORMS } from "@carrier-explode/schema/types";
import { OTA_FEEDS, type ReleaseKey } from "@carrier-explode/storage";

const str = v.pipe(v.string(), v.minLength(1));
const url = v.pipe(v.string(), v.url());
const day = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));
const month = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}$/));
const major = v.pipe(v.number(), v.integer(), v.minValue(1));
const nonEmpty = <S extends v.GenericSchema>(item: S) => v.pipe(v.array(item), v.minLength(1));

/** One iOS build: its in-scope IPSWs, extracted one after another. `label` is what pages show (`27.2 beta 2`). */
const iosBuildSchema = v.object({
	build: str,
	version: str,
	label: str,
	prerelease: v.boolean(),
	released: v.exactOptional(day),
	ipsws: nonEmpty(v.object({ device: str, url })),
});

/** One Pixel's OTA of one build. `version` is the Android major. */
const pixelDeviceSchema = v.object({
	build: str,
	version: str,
	patch: month,
	device: str,
	url,
});

/** One Galaxy firmware: `build` is its CSC build, `major` the Android major its AP member names. */
const galaxyBuildSchema = v.object({
	model: str,
	/** The FUS region it is served for: `XAA`. */
	region: str,
	/** `PDA/CSC/PHONE/DATA`, as BinaryInform asks for it. */
	version: v.pipe(v.string(), v.regex(/^\w+\/\w+\/\w*\/\w+$/)),
	build: str,
	major,
});

/** A release record's key: a Pixel's names its device. */
const releaseKeySchema = v.variant("platform", [
	v.object({ platform: v.literal("ios"), id: v.pipe(v.tuple([str]), v.readonly()) }),
	v.object({ platform: v.literal("android"), id: v.pipe(v.tuple([str, str]), v.readonly()) }),
	v.object({ platform: v.literal("samsung"), id: v.pipe(v.tuple([str]), v.readonly()) }),
]) satisfies v.GenericSchema<unknown, ReleaseKey>;

/** One release record: what a reindex rebuilds, and the index message that indexes it. */
export const releaseTargetSchema = v.object({ kind: v.literal("release"), release: releaseKeySchema });

/** What a reindex rebuilds: one release record, one OTA file, or every held record of one platform (its OTA feed's files with it) or of all. */
const reindexTargetSchema = v.variant("kind", [
	releaseTargetSchema,
	v.object({ kind: v.literal("ota"), feed: v.picklist(OTA_FEEDS), url }),
	v.object({ kind: v.literal("all"), platform: v.exactOptional(v.picklist(RELEASE_PLATFORMS)) }),
]);

export const PIPELINE_NAMES = [
	"ios-build",
	"apple-ota",
	"pixel-device",
	"pixel-ota",
	"galaxy-build",
	"labels",
	"dataset",
	"reindex",
] as const;
export type PipelineName = (typeof PIPELINE_NAMES)[number];

const DAILY = "35 3 * * *";
/** A check tops a container pipeline up to its CONTAINER_SHARE of live builds; one that ends waits up to this long for the next. */
const EVERY_20_MINUTES = "*/20 * * * *";
/** Galaxy's own minutes, so production can schedule it without the iOS check. */
const EVERY_20_MINUTES_AT_10 = "10,30,50 * * * *";
const SIX_HOURLY = "7 */6 * * *";
/** Its own minute, so production can schedule it without Pixel's daily check. */
const DAILY_DATASET = "50 3 * * *";
/** Mondays: names change slowly, and each costs a search and a model call. */
const WEEKLY = "17 4 * * 1";

/**
 * `cron`: when its feed is checked, or null for a pipeline only run by hand. `container`: its instances each hold a
 * container, so a check keeps it to its CONTAINER_SHARE of the container class's max_instances.
 */
export const PIPELINES = {
	"ios-build": { binding: "IOS_BUILD", params: iosBuildSchema, cron: EVERY_20_MINUTES, container: true },
	"apple-ota": {
		binding: "APPLE_OTA",
		params: v.object({ manifest: sha1Schema }),
		cron: SIX_HOURLY,
		container: false,
	},
	"pixel-device": { binding: "PIXEL_DEVICE", params: pixelDeviceSchema, cron: DAILY, container: false },
	"pixel-ota": {
		binding: "PIXEL_OTA",
		params: v.object({ snapshot: sha1Schema }),
		cron: SIX_HOURLY,
		container: false,
	},
	"galaxy-build": {
		binding: "GALAXY_BUILD",
		params: galaxyBuildSchema,
		cron: EVERY_20_MINUTES_AT_10,
		container: true,
	},
	labels: { binding: "LABELS", params: v.object({ week: day }), cron: WEEKLY, container: false },
	dataset: { binding: "DATASET", params: v.object({ day }), cron: DAILY_DATASET, container: false },
	reindex: {
		binding: "REINDEX",
		params: v.object({ target: reindexTargetSchema }),
		cron: null,
		container: false,
	},
} as const satisfies { readonly [P in PipelineName]: Pipeline };

interface Pipeline {
	readonly binding: string;
	readonly params: v.GenericSchema;
	readonly cron: string | null;
	readonly container: boolean;
}

export type ContainerPipeline = {
	readonly [P in PipelineName]: (typeof PIPELINES)[P]["container"] extends true ? P : never;
}[PipelineName];

export type PipelineParams<P extends PipelineName> = v.InferOutput<(typeof PIPELINES)[P]["params"]>;

/** The pipelines a feed check plans: all but reindex. */
export type FeedName = {
	readonly [P in PipelineName]: (typeof PIPELINES)[P]["cron"] extends string ? P : never;
}[PipelineName];
export const FEED_NAMES = PIPELINE_NAMES.filter((p): p is FeedName => PIPELINES[p].cron !== null);

/**
 * POST /run's body: a feed's check (with `rebuild`, its failed units run again; with `only`, just the planned units of
 * those instance ids start), a reindex, or a platform derived again.
 */
export const runRequestSchema = v.variant("run", [
	v.object({
		run: v.picklist(FEED_NAMES),
		rebuild: v.optional(v.boolean(), false),
		only: v.exactOptional(v.array(str)),
	}),
	v.object({ run: v.literal("reindex"), target: reindexTargetSchema }),
	v.object({ run: v.literal("rederive"), platform: v.picklist(RELEASE_PLATFORMS) }),
]);
export type RunRequest = v.InferOutput<typeof runRequestSchema>;
