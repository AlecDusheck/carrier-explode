/**
 * Once a week: each code the index uses that nothing names, up to LABELLER.perKind of a subject, named by a model where a
 * search finds its name; then a publish, which is what puts a name on the pages.
 */

import { NonRetryableError } from "cloudflare:workflows";
import * as v from "valibot";

import { indexDb, unnamed, writeLabels } from "@carrier-explode/db/d1";
import { LABEL_SUBJECTS } from "@carrier-explode/schema/records";
import type { Json } from "@carrier-explode/schema/types";
import { describe } from "../errors.ts";
import type { Env } from "../worker/env.ts";
import { ANSWER_FORMAT, nameCode, type Labeller } from "../worker/labels.ts";
import { PIPELINES } from "../worker/pipelines.ts";
import type { RunContext } from "../worker/run-job.ts";
import { QUICK } from "../worker/steps.ts";
import { Pipeline, settle } from "./pipeline.ts";
import { requestPublish } from "./tail.ts";

/** Search and model through the AI binding, both through the configured AI Gateway. */
function labellerOf(env: Env): Labeller {
  const { gateway, provider, model } = env.LABELLER;
  return {
    search: async (query) => {
      const r = await env.AI.websearch({ gatewayId: gateway, provider, query, limit: 8 });
      if (r.ok) return r.json();
      const failure = `web search "${query}": ${r.status} ${await r.text()}`;
      // A 4xx (402: the gateway has no search credits) fails the same way on every retry.
      throw r.status < 500 && r.status !== 429 ? new NonRetryableError(failure) : new Error(failure);
    },
    ask: (content) => env.AI.run(model, { messages: [{ role: "user", content }], response_format: ANSWER_FORMAT }, { gateway: { id: gateway } }),
  };
}

export class LabelsWorkflow extends Pipeline {
  protected async steps(c: RunContext, payload: unknown): Promise<Json> {
    v.parse(PIPELINES.labels.params, payload);
    const labeller = labellerOf(c.env);
    const named: string[] = [];
    const failed: string[] = [];
    for (const subject of LABEL_SUBJECTS) {
      const codes = await c.step.do(`unnamed ${subject}`, QUICK, () => unnamed(indexDb(c.env.DB), subject));
      for (const code of codes.slice(0, c.env.LABELLER.perKind)) {
        try {
          // The write is in the step, so a replay neither searches nor writes again.
          const value = await c.step.do(`name ${subject} ${code}`, QUICK, async () => {
            const name = await nameCode(labeller, subject, code);
            if (name === null) return null;
            await writeLabels(indexDb(c.env.DB), [{ subject, code, field: "name", value: name.value, origin: "model", evidence: name.evidence }], new Date().toISOString());
            return name.value;
          });
          if (value !== null) named.push(`${subject} ${code}: ${value}`);
        } catch (e) {
          failed.push(`${subject} ${code}: ${describe(e)}`);
        }
      }
    }
    const publish = named.length ? await requestPublish(c) : null;
    return settle({ named, publish }, failed);
  }
}
