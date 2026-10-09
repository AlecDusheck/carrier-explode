/** The Workflows of no family: a feed's check, the weekly labels run, and a reindex. */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import * as v from "valibot";

import {
	CANDIDATE_SUBJECT,
	indexDb,
	LABEL_CANDIDATE_KINDS,
	labelCandidates,
	writeLabelMiss,
	writeLabels,
} from "@carrier-explode/db";
import { keys } from "@carrier-explode/storage";
import type { Env } from "./env.ts";
import { describe } from "./errors.ts";
import type { IndexMessage } from "./indexing.ts";
import { ANSWER_FORMAT, nameCode, type Labeller } from "./labels.ts";
import { pend } from "./normalize.ts";
import { PIPELINES } from "./pipelines.ts";
import { queuePurge } from "./queues.ts";
import { reindexArtifacts, reindexPlatforms } from "./reindex.ts";
import { checkFeed, type Checked } from "./runs.ts";
import { doStep, finish, normalizeSteps, UnitWorkflow, type UnitRun } from "./unit.ts";

/** Search and model through the AI binding, both through the configured AI Gateway. */
function labellerOf(env: Env): { readonly labeller: Labeller; readonly perKind: number } {
	const { AI: ai, LABELLER: config } = env;
	const { gateway, provider, model, perKind } = config;
	const labeller: Labeller = {
		search: async (query) => {
			const r = await ai.websearch({ gatewayId: gateway, provider, query, limit: 8 });
			if (r.ok) return r.json();
			const failure = `web search "${query}": ${r.status} ${await r.text()}`;
			// A 4xx (402: the gateway has no search credits) fails the same way on every retry.
			throw r.status < 500 && r.status !== 429 ? new NonRetryableError(failure) : new Error(failure);
		},
		ask: (content) =>
			ai.run(
				model,
				{ messages: [{ role: "user", content }], response_format: ANSWER_FORMAT, reasoning_effort: "low" },
				{ gateway: { id: gateway } },
			),
	};
	return { labeller, perKind };
}

/**
 * Once a week: up to LABELLER.perKind codes of each kind that nothing names, each named where a search finds a page
 * giving its name, else noted as missed.
 */
export class LabelsWorkflow extends WorkflowEntrypoint<Env, unknown> {
	override async run(
		event: Readonly<WorkflowEvent<unknown>>,
		step: WorkflowStep,
	): Promise<{ readonly named: readonly string[]; readonly missed: readonly string[] }> {
		const { week: today } = v.parse(PIPELINES.labels.params, event.payload);
		const { labeller, perKind } = labellerOf(this.env);
		const named: string[] = [];
		const missed: string[] = [];
		const failed: string[] = [];
		for (const kind of LABEL_CANDIDATE_KINDS) {
			const subject = CANDIDATE_SUBJECT[kind];
			const candidates = await doStep(step, `unnamed ${kind}`, this.env, () =>
				labelCandidates(indexDb(this.env.DB), kind, perKind, today),
			);
			for (const candidate of candidates) {
				const { code } = candidate;
				try {
					const value = await doStep(step, `name ${subject} ${code}`, this.env, async () => {
						const db = indexDb(this.env.DB);
						const name = await nameCode(labeller, candidate);
						if (name === null) {
							await writeLabelMiss(db, subject, code, today);
							return null;
						}
						await writeLabels(db, [
							{ subject, code, field: "name", value: name.value, origin: "model", evidence: name.evidence },
						]);
						return `${name.value} (${name.evidence})`;
					});
					if (value === null) missed.push(`${subject} ${code}`);
					else named.push(`${subject} ${code}: ${value}`);
				} catch (e) {
					// One code's failure leaves the others to name; the instance still ends in error below.
					failed.push(`${subject} ${code}: ${describe(e)}`);
				}
			}
		}
		if (named.length > 0) await doStep(step, "purge", this.env, () => queuePurge(this.env));
		if (failed.length > 0) throw new Error(`${failed.length} code(s) failed: ${failed.join(" | ")}`);
		return { named, missed };
	}
}

/** A feed's check: its plan made in steps, then its units started. */
export class CheckWorkflow extends WorkflowEntrypoint<Env, unknown> {
	override async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep): Promise<Checked> {
		const params = v.parse(PIPELINES.check.params, event.payload);
		return checkFeed(this.env, params, (name, run) => doStep(step, name, this.env, run));
	}
}

/**
 * Records' missing norm/ objects normalized, by hand after a schema bump or a lost index, then queued: one record to index as its unit
 * would; all of them only once every one is normalized, as each platform's `reindex` chain, since a source derives from
 * every record's copies of it.
 */
export class ReindexWorkflow extends UnitWorkflow {
	protected async extract(payload: unknown, r: UnitRun): Promise<readonly IndexMessage[]> {
		const { target } = v.parse(PIPELINES.reindex.params, payload);
		const pending = await doStep(r.step, "artifacts", r.env, async () =>
			pend(
				r.unit.bucket,
				keys.tmp(r.unit.instance, "artifacts.json"),
				await reindexArtifacts(r.unit.bucket, target),
			),
		);
		await normalizeSteps(r, "normalize", pending);
		return finish(r, "index", async () => {
			switch (target.kind) {
				case "release":
					return [target];
				case "ota":
					return [{ kind: "ota", feed: target.feed, urls: [target.url] }];
				case "all":
					return reindexPlatforms(target.platform).map((platform) => ({
						kind: "reindex",
						platform,
						after: null,
					}));
			}
		});
	}
}
