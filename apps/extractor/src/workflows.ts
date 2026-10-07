/** The Workflows of no family: the weekly labels run, and a reindex. */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import * as v from "valibot";

import { indexDb, unnamed, writeLabels } from "@carrier-explode/db";
import { LABEL_SUBJECTS } from "@carrier-explode/schema/records";
import { keys } from "@carrier-explode/storage";
import type { Env } from "./env.ts";
import { describe } from "./errors.ts";
import type { IndexMessage } from "./indexing.ts";
import { ANSWER_FORMAT, nameCode, type Labeller, type NamedSubject } from "./labels.ts";
import { pend } from "./normalize.ts";
import { PIPELINES } from "./pipelines.ts";
import { queuePurge } from "./queues.ts";
import { reindexArtifacts, reindexPlatforms } from "./reindex.ts";
import { doStep, finish, normalizeSteps, STEP, UnitWorkflow, type UnitRun } from "./unit.ts";

/** Search and model through the AI binding, both through the configured AI Gateway; an environment without them fails the instance once. */
function labellerOf(env: Env): { readonly labeller: Labeller; readonly perKind: number } {
	const { AI: ai, LABELLER: config } = env;
	if (ai === undefined || config === undefined)
		throw new NonRetryableError("labels: this environment has no AI binding or no LABELLER");
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
				{ messages: [{ role: "user", content }], response_format: ANSWER_FORMAT },
				{ gateway: { id: gateway } },
			),
	};
	return { labeller, perKind };
}

const NAMED = LABEL_SUBJECTS.filter((s): s is NamedSubject => s !== "source");

/** Once a week: each code the index uses that nothing names, up to LABELLER.perKind of a subject, named where a search finds its name. */
export class LabelsWorkflow extends WorkflowEntrypoint<Env, unknown> {
	override async run(
		event: Readonly<WorkflowEvent<unknown>>,
		step: WorkflowStep,
	): Promise<{ readonly named: readonly string[] }> {
		v.parse(PIPELINES.labels.params, event.payload);
		const { labeller, perKind } = labellerOf(this.env);
		const named: string[] = [];
		const failed: string[] = [];
		for (const subject of NAMED) {
			const codes = await doStep(step, `unnamed ${subject}`, STEP, () =>
				unnamed(indexDb(this.env.DB), subject),
			);
			for (const code of codes.slice(0, perKind)) {
				try {
					const value = await doStep(step, `name ${subject} ${code}`, STEP, async () => {
						const name = await nameCode(labeller, subject, code);
						if (name === null) return null;
						await writeLabels(indexDb(this.env.DB), [
							{ subject, code, field: "name", value: name.value, origin: "model", evidence: name.evidence },
						]);
						return name.value;
					});
					if (value !== null) named.push(`${subject} ${code}: ${value}`);
				} catch (e) {
					// One code's failure leaves the others to name; the instance still ends in error below.
					failed.push(`${subject} ${code}: ${describe(e)}`);
				}
			}
		}
		if (named.length > 0) await doStep(step, "purge", STEP, () => queuePurge(this.env));
		if (failed.length > 0) throw new Error(`${failed.length} code(s) failed: ${failed.join(" | ")}`);
		return { named };
	}
}

/**
 * Records' missing norm/ objects normalized, by hand after a PROFILE_SCHEMA bump or a lost index, then queued: one record to index as its unit
 * would; all of them only once every one is normalized, as each platform's `reindex` chain, since a source derives from
 * every record's copies of it.
 */
export class ReindexWorkflow extends UnitWorkflow {
	protected async extract(payload: unknown, r: UnitRun): Promise<readonly IndexMessage[]> {
		const { target } = v.parse(PIPELINES.reindex.params, payload);
		const pending = await doStep(r.step, "artifacts", STEP, async () =>
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
