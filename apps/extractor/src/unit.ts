/** The base of every unit's Workflow: its extract steps, the last of which writes the unit's record and queues it. */

import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
	type WorkflowStepConfig,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { indexDb, type IndexDb } from "@carrier-explode/db";
import { keys, putJson, type OtaFeed, type OtaPointer } from "@carrier-explode/storage";
import type { ContainerJob } from "./container-protocol.ts";
import { JOB_DEADLINE_MS } from "./container.ts";
import type { Env } from "./env.ts";
import { describe, permanent } from "./errors.ts";
import { otaMessages, type IndexMessage } from "./indexing.ts";
import { normalizeRun, type Pending } from "./normalize.ts";
import { queueIndex } from "./queues.ts";
import type { Scope } from "./scope.ts";

/** Fetch, R2 and D1 failures. */
export const STEP: WorkflowStepConfig = {
	retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
	timeout: "30 minutes",
};

/** A container killed or disconnected, a bucket request lost or the job's deadline passed: one more run, in a fresh container. */
const CONTAINER_STEP: WorkflowStepConfig = {
	retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
	// Past the job's own deadline, so the container is destroyed before the step gives up on it.
	timeout: JOB_DEADLINE_MS + 60_000,
};

/** The container of one attempt at one step: a retry never posts a second job into a container still running the first. */
export const containerName = (instance: string, step: string, attempt: number): string =>
	`${instance}:${step}:${attempt}`;

/** `step.do`, with a permanent failure made a NonRetryableError. */
export function doStep<T extends Rpc.Serializable<T>>(
	step: WorkflowStep,
	name: string,
	config: WorkflowStepConfig,
	run: () => Promise<T>,
): Promise<T> {
	return step.do(name, config, async () => {
		try {
			return await run();
		} catch (e) {
			throw permanent(e) ? new NonRetryableError(`${name}: ${describe(e)}`) : e;
		}
	});
}

/** What a unit's step functions reach. */
export interface UnitContext {
	readonly bucket: R2Bucket;
	/** Read only, for the shas already held: a unit never writes the index. */
	readonly db: IndexDb;
	/** The instance id, which is the unit: names its tmp/<instance>/ objects and its containers. */
	readonly instance: string;
	readonly scope: Scope;
}

export interface UnitRun {
	readonly env: Env;
	readonly step: WorkflowStep;
	readonly unit: UnitContext;
}

/** One container job, awaited in one step, to its output as JSON text. */
export function containerStep(r: UnitRun, name: string, job: ContainerJob): Promise<string> {
	return r.step.do(name, CONTAINER_STEP, async (ctx) => {
		const answer = await r.env.EXTRACTOR.getByName(containerName(r.unit.instance, name, ctx.attempt)).run(
			job,
		);
		if (answer.ok) return answer.output;
		const message = `${name}: ${answer.error}`;
		throw answer.permanent ? new NonRetryableError(message) : new Error(message);
	});
}

/** A pending list normalized, one step per run of it. */
export async function normalizeSteps(r: UnitRun, name: string, pending: Pending): Promise<void> {
	for (const run of pending.batches)
		await doStep(r.step, `${name} ${run[0]}-${run[1]}`, STEP, () =>
			normalizeRun(r.unit.bucket, pending.key, run),
		);
}

/** The unit's last step: `write` writes its record (or pointer) and says what to index, which is queued in the same step. */
export function finish(
	r: UnitRun,
	name: string,
	write: () => Promise<readonly IndexMessage[]>,
): Promise<IndexMessage[]> {
	return doStep(r.step, name, STEP, async () => {
		const messages = [...(await write())];
		await queueIndex(r.env, messages);
		return messages;
	});
}

/** An OTA snapshot's steps: which files it changes, each file, then its pointer, last: the snapshot is held once every file it lists is. */
export interface OtaSteps {
	readonly plan: (u: UnitContext) => Promise<readonly string[]>;
	/** Whether the file is held once done. */
	readonly file: (url: string, u: UnitContext) => Promise<boolean>;
	/** Indexed before the files. */
	readonly first: readonly IndexMessage[];
}

export async function otaSnapshot(
	r: UnitRun,
	feed: OtaFeed,
	sha1: string,
	steps: OtaSteps,
): Promise<IndexMessage[]> {
	const urls = await doStep(r.step, "plan", STEP, async () => [...(await steps.plan(r.unit))]);
	const held: string[] = [];
	for (const url of urls)
		if (await doStep(r.step, `file ${url}`, STEP, () => steps.file(url, r.unit))) held.push(url);
	return finish(r, "pointer", async () => {
		await putJson(r.env.BUCKET, keys.otaCurrent(feed), { sha1 } satisfies OtaPointer);
		return [...steps.first, ...otaMessages(feed, held)];
	});
}

/** What a unit's instance returns: the messages it queued for indexing. */
export interface UnitResult {
	readonly queued: readonly IndexMessage[];
}

export abstract class UnitWorkflow extends WorkflowEntrypoint<Env, unknown> {
	/** The unit's steps, ending in `finish`. Validates its own payload: instances can be created outside a check. */
	protected abstract extract(payload: unknown, r: UnitRun): Promise<readonly IndexMessage[]>;

	override async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep): Promise<UnitResult> {
		const r: UnitRun = {
			env: this.env,
			step,
			unit: {
				bucket: this.env.BUCKET,
				db: indexDb(this.env.DB),
				instance: event.instanceId,
				scope: this.env.SCOPE,
			},
		};
		return { queued: await this.extract(event.payload, r) };
	}
}
