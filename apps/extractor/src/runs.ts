/**
 * Runs: one Workflow instance per unit, named by its pipeline and unit (`galaxy-build-S942UOYN4BZID`), so a planned
 * unit is never started twice; a held iOS build adds its held phones' digest, so a phone listed for it plans it again;
 * a reindex adds when it was asked for, so it runs each time.
 */

import { crc32 } from "@carrier-explode/binary";
import { keys } from "@carrier-explode/storage";
import { checkIos } from "./apple/check.ts";
import { checkAppleOta } from "./apple/ota.ts";
import type { Env } from "./env.ts";
import { checkGalaxy } from "./galaxy/check.ts";
import { checkPixel } from "./pixel/check.ts";
import { checkPixelOta } from "./pixel/ota.ts";
import {
	FEED_NAMES,
	PIPELINE_NAMES,
	PIPELINES,
	type ContainerPipeline,
	type FeedName,
	type PipelineName,
	type PipelineParams,
} from "./pipelines.ts";
import { chunks } from "./fan-out.ts";
import { heldIosPhones } from "./store.ts";

/** Workflows take instance ids of up to 100 characters of [A-Za-z0-9_-]. */
const MAX_ID = 100;

export function instanceId(pipeline: PipelineName, unit: string): string {
	const id = `${pipeline}-${unit.replace(/[^\w-]/g, "_")}`;
	if (id.length > MAX_ID) throw new Error(`instance id too long: ${id}`);
	return id;
}

/** The pipeline an instance id belongs to, read back from its prefix. */
export const pipelineOfInstance = (id: string): PipelineName | undefined =>
	PIPELINE_NAMES.find((p) => id.startsWith(`${p}-`));

/** A run's Workflow instance: its pipeline, its unit's id, its params. */
export type Run = {
	readonly [P in PipelineName]: {
		readonly pipeline: P;
		readonly id: string;
		readonly params: PipelineParams<P>;
	};
}[PipelineName];

/**
 * A planned iOS build, named by the phones its record holds (`held`; undefined before it has one), which change only once
 * an instance of it ends: a build has one live instance, however its IPSWs change meanwhile.
 */
export function iosRun(
	params: PipelineParams<"ios-build">,
	held: ReadonlySet<string> | undefined,
): Extract<Run, { readonly pipeline: "ios-build" }> {
	if (held === undefined) return { pipeline: "ios-build", params, id: instanceId("ios-build", params.build) };
	const digest = crc32(new TextEncoder().encode([...held].toSorted().join(" ")))
		.toString(16)
		.padStart(8, "0");
	return { pipeline: "ios-build", params, id: instanceId("ios-build", `${params.build}-${digest}`) };
}

type PlannedFeed = Exclude<FeedName, "ios-build">;

/** A planned run of any other feed, named by its unit. */
export function runOf(
	r: {
		readonly [P in PlannedFeed]: { readonly pipeline: P; readonly params: PipelineParams<P> };
	}[PlannedFeed],
): Run {
	switch (r.pipeline) {
		case "galaxy-build":
			return { ...r, id: instanceId(r.pipeline, r.params.build) };
		case "pixel-device":
			return { ...r, id: instanceId(r.pipeline, `${r.params.build}-${r.params.device}`) };
		case "apple-ota":
			return { ...r, id: instanceId(r.pipeline, r.params.manifest) };
		case "pixel-ota":
			return { ...r, id: instanceId(r.pipeline, r.params.snapshot) };
		case "labels":
			return { ...r, id: instanceId(r.pipeline, r.params.week) };
		case "dataset":
			return { ...r, id: instanceId(r.pipeline, r.params.day) };
	}
}

/** A reindex's target as an id: an OTA file by its record's key, as a URL may be longer than an id. */
async function reindexUnit(target: PipelineParams<"reindex">["target"]): Promise<string> {
	switch (target.kind) {
		case "release":
			return `${target.release.platform}-${target.release.id.join("-")}`;
		case "ota":
			return `${target.feed}-${(await keys.otaFile(target.feed, target.url)).slice(keys.otaFilesPrefix(target.feed).length, -".json".length)}`;
		case "all":
			return `all-${target.platform ?? "platforms"}`;
	}
}

/** A reindex asked for `at`, named by its target and that second. */
export async function reindexRun(
	params: PipelineParams<"reindex">,
	at: Date,
): Promise<Extract<Run, { readonly pipeline: "reindex" }>> {
	const unit = await reindexUnit(params.target);
	return {
		pipeline: "reindex",
		params,
		id: instanceId("reindex", `${unit}-${at.toISOString().replace(/\D/g, "").slice(0, 14)}`),
	};
}

type Status = InstanceStatus["status"];

/** The statuses of an instance that has not finished. */
const LIVE: ReadonlySet<Status> = new Set<Status>([
	"queued",
	"running",
	"paused",
	"waiting",
	"waitingForPause",
]);
const FAILED: ReadonlySet<Status> = new Set<Status>(["errored", "terminated"]);

export const workflowOf = (env: Env, pipeline: PipelineName): Workflow => env[PIPELINES[pipeline].binding];

/** An instance's status; null when there is none. */
async function statusOf(env: Env, pipeline: PipelineName, id: string): Promise<Status | null> {
	try {
		return (await (await workflowOf(env, pipeline).get(id)).status()).status;
	} catch (e) {
		if (e instanceof Error && /not.?found/i.test(e.message)) return null;
		throw e;
	}
}

/** What a check did with the units it planned. */
export interface Started {
	readonly started: readonly string[];
	readonly live: readonly string[];
	/** Ended in error: listed by every check until one asks to rebuild them. */
	readonly failed: readonly string[];
	/** Planned but left for a later check: every container is taken. */
	readonly waiting: readonly string[];
}

/** What to do with each planned unit, by its instance's status; the order of `runs` (oldest first) is the order of starts. */
export function decide(
	runs: ReadonlyArray<{ readonly id: string; readonly status: Status | null }>,
	rebuild: boolean,
	room: number,
): Started & { readonly restart: readonly string[] } {
	const live = runs.filter((r) => r.status !== null && LIVE.has(r.status)).map((r) => r.id);
	const failed = runs.filter((r) => r.status !== null && FAILED.has(r.status)).map((r) => r.id);
	const restart = rebuild ? failed : [];
	const wanted = [...runs.filter((r) => r.status === null).map((r) => r.id), ...restart];
	const free = Math.max(0, room - live.length);
	const now = wanted.slice(0, free);
	return {
		started: now,
		restart: restart.filter((id) => now.includes(id)),
		live,
		failed: rebuild ? [] : failed,
		waiting: wanted.slice(free),
	};
}

const holdsContainer = (p: PipelineName): p is ContainerPipeline => PIPELINES[p].container;

/** How many of a pipeline's instances may be live. */
export const roomFor = (env: Pick<Env, "CONTAINER_SHARE">, pipeline: PipelineName): number =>
	holdsContainer(pipeline) ? env.CONTAINER_SHARE[pipeline] : Number.POSITIVE_INFINITY;

/** The most instances one createBatch call takes. */
const BATCH = 100;

/** Starts what `runs` plans that has no instance (and, rebuilding, restarts the failed), up to its room; the rest wait. */
export async function startRuns(
	env: Env,
	pipeline: PipelineName,
	runs: readonly Run[],
	rebuild: boolean,
): Promise<Started> {
	const workflow = workflowOf(env, pipeline);
	const statuses = await Promise.all(
		runs.map(async (r) => ({ id: r.id, status: await statusOf(env, pipeline, r.id) })),
	);
	const d = decide(statuses, rebuild, roomFor(env, pipeline));
	const restarting = new Set(d.restart);
	const fresh = runs
		.filter((r) => d.started.includes(r.id) && !restarting.has(r.id))
		.map(({ id, params }) => ({ id, params }));
	// createBatch skips an id already taken, so a check racing another starts nothing twice.
	for (const instances of chunks(fresh, BATCH)) await workflow.createBatch({ instances });
	for (const id of d.restart) await (await workflow.get(id)).restart();
	return { started: d.started, live: d.live, failed: d.failed, waiting: d.waiting };
}

/** Today, YYYY-MM-DD: the labels and dataset runs' unit, as their crons fire them. */
const today = (): string => new Date().toISOString().slice(0, 10);

async function plan(env: Env, feed: FeedName): Promise<Run[]> {
	switch (feed) {
		case "ios-build": {
			const held = await heldIosPhones(env.BUCKET);
			return (await checkIos(env, held)).map((params) => iosRun(params, held.get(params.build)));
		}
		case "pixel-device":
			return (await checkPixel(env)).map((params) => runOf({ pipeline: feed, params }));
		case "galaxy-build":
			return (await checkGalaxy(env)).map((params) => runOf({ pipeline: feed, params }));
		case "apple-ota": {
			const params = await checkAppleOta(env);
			return params === null ? [] : [runOf({ pipeline: feed, params })];
		}
		case "pixel-ota": {
			const params = await checkPixelOta(env);
			return params === null ? [] : [runOf({ pipeline: feed, params })];
		}
		case "labels":
			return [runOf({ pipeline: feed, params: { week: today() } })];
		case "dataset":
			return [runOf({ pipeline: feed, params: { day: today() } })];
	}
}

/** Plans the units its feed lists that the bucket does not hold, and starts them, or of them only the ids in `only`. */
export async function checkFeed(
	env: Env,
	feed: FeedName,
	rebuild: boolean,
	only?: readonly string[],
): Promise<Started & { readonly planned: readonly Run[] }> {
	const planned = await plan(env, feed);
	const runs = only === undefined ? planned : planned.filter((r) => only.includes(r.id));
	return { ...(await startRuns(env, feed, runs, rebuild)), planned };
}

/** Checks the feeds due now (a scheduled run has 15 minutes). */
export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
	const due = FEED_NAMES.filter((f) => env.PIPELINE_CRONS[f] === controller.cron);
	if (!due.length) throw new Error(`no feed is checked at "${controller.cron}"`);
	const checked = await Promise.allSettled(due.map((feed) => checkFeed(env, feed, false)));
	const failed = checked.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
	if (failed.length)
		throw new AggregateError(failed, `cron ${controller.cron}: ${failed.length} feed check(s) failed`);
}
