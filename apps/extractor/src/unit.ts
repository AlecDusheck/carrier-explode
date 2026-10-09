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
import type { Env } from "./env.ts";
import { describe, failureOf, permanent, REFUSED_TWICE } from "./errors.ts";
import { otaMessages, type IndexMessage } from "./indexing.ts";
import { normalizeRun, type Pending } from "./normalize.ts";
import { queueIndex } from "./queues.ts";
import type { Scope } from "./scope.ts";

type StepEnv = Pick<Env, "STEP_RETRIES" | "STEP_TIMEOUT_MS">;

/** A container killed or disconnected, a bucket request lost or the job's deadline passed: another run, in a fresh container. */
const containerStepConfig = (env: StepEnv & Pick<Env, "CONTAINER_LIMITS">): WorkflowStepConfig => ({
	retries: { limit: env.STEP_RETRIES.container, delay: env.STEP_RETRIES.delayMs, backoff: "exponential" },
	// Past the job's own deadline, so the container is destroyed before the step gives up on it.
	timeout: env.CONTAINER_LIMITS.jobDeadlineMs + 60_000,
});

/** The container of one attempt at one step: a retry never posts a second job into a container still running the first. */
export const containerName = (instance: string, step: string, attempt: number): string =>
	`${instance}:${step}:${attempt}`;

const stepConfig = (env: StepEnv): WorkflowStepConfig => ({
	retries: { limit: env.STEP_RETRIES.step, delay: env.STEP_RETRIES.delayMs, backoff: "exponential" },
	timeout: env.STEP_TIMEOUT_MS,
});

/** `step.do`, retried through fetch, R2 and D1 failures, with a permanent failure made a NonRetryableError. */
export function doStep<T extends Rpc.Serializable<T>>(
	step: WorkflowStep,
	name: string,
	env: StepEnv,
	run: () => Promise<T>,
): Promise<T> {
	return step.do(name, stepConfig(env), async () => {
		try {
			return await run();
		} catch (e) {
			throw permanent(e) ? new NonRetryableError(`${name}: ${describe(e)}`) : e;
		}
	});
}

/** A WAF's block of a burst lifts within minutes. */
const BURST_WAIT = "5 minutes";
/** One attempt at a unit's step: its output as JSON text, or the burst refusal it met. */
type Attempt = { readonly output: string } | { readonly refused: string };

/** A step refused a burst runs once more BURST_WAIT on; refused again, it ends the unit. */
async function pastBurst(
	r: UnitRun,
	name: string,
	attempt: (name: string) => Promise<Attempt>,
): Promise<string> {
	const first = await attempt(name);
	if ("output" in first) return first.output;
	await r.step.sleep(`${name} refused`, BURST_WAIT);
	const again = await attempt(`${name} again`);
	if ("output" in again) return again.output;
	throw new Error(`${REFUSED_TWICE} ${name}: ${again.refused}`);
}

/** `doStep` for a unit's step whose server may refuse a burst (errors.ts BurstRefusal). */
export function refusableStep(r: UnitRun, name: string, run: () => Promise<string>): Promise<string> {
	return pastBurst(r, name, (attempt) =>
		r.step.do(attempt, stepConfig(r.env), async (): Promise<Attempt> => {
			try {
				return { output: await run() };
			} catch (e) {
				const failure = failureOf(e);
				if (failure === "burst") return { refused: describe(e) };
				throw failure === "permanent" ? new NonRetryableError(`${attempt}: ${describe(e)}`) : e;
			}
		}),
	);
}

/** A Workflow's steps, each named, retried and its result kept: a check plans in them. */
export type Steps = <T extends Rpc.Serializable<T>>(name: string, run: () => Promise<T>) => Promise<T>;

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
	return pastBurst(r, name, (attempt) =>
		r.step.do(attempt, containerStepConfig(r.env), async (ctx): Promise<Attempt> => {
			const answer = await r.env.EXTRACTOR.getByName(
				containerName(r.unit.instance, attempt, ctx.attempt),
			).run(job);
			if (answer.ok) return { output: answer.output };
			if (answer.failure === "burst") return { refused: answer.error };
			const message = `${attempt}: ${answer.error}`;
			throw answer.failure === "permanent" ? new NonRetryableError(message) : new Error(message);
		}),
	);
}

/** A pending list normalized, one step per run of it. */
export async function normalizeSteps(r: UnitRun, name: string, pending: Pending): Promise<void> {
	for (const run of pending.batches)
		await doStep(r.step, `${name} ${run[0]}-${run[1]}`, r.env, () =>
			normalizeRun(r.unit.bucket, pending.key, run),
		);
}

/** The unit's last step: `write` writes its record (or pointer) and says what to index, which is queued in the same step. */
export function finish(
	r: UnitRun,
	name: string,
	write: () => Promise<readonly IndexMessage[]>,
): Promise<IndexMessage[]> {
	return doStep(r.step, name, r.env, async () => {
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
	const urls = await doStep(r.step, "plan", r.env, async () => [...(await steps.plan(r.unit))]);
	const held: string[] = [];
	for (const url of urls)
		if (await doStep(r.step, `file ${url}`, r.env, () => steps.file(url, r.unit))) held.push(url);
	return finish(r, "pointer", async () => {
		await putJson(r.env.BUCKET, keys.otaCurrent(feed), { sha1 } satisfies OtaPointer);
		return [...steps.first, ...otaMessages(feed, held, r.env.INDEX_BATCH.otaFiles)];
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
