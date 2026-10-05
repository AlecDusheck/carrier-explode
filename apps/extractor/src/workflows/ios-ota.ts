/** One OTA manifest: ios.ota over the files it lists that the bucket lacks, files.json, then profiles and a publish when anything changed. */

import * as v from "valibot";

import type { Json } from "@carrier-explode/schema/types";
import { fanOut, failures, succeeded } from "../fan-out.ts";
import { recordOta } from "../feeds/apple-ota/index.ts";
import { PIPELINES } from "../worker/pipelines.ts";
import { runJob, type RunContext } from "../worker/run-job.ts";
import { Pipeline, settle } from "./pipeline.ts";
import { normalizeShas, requestPublish } from "./tail.ts";

export class IosOtaWorkflow extends Pipeline {
  protected async steps(c: RunContext, payload: unknown): Promise<Json> {
    const { manifest, fetch } = v.parse(PIPELINES["ios-ota"].params, payload);
    const per = c.env.OTA_FILES_PER_JOB;
    const parts = Array.from({ length: Math.ceil(fetch.length / per) }, (_, i) => fetch.slice(i * per, (i + 1) * per));
    const done = await fanOut(parts.map((urls, i) => ({ urls, i })), parts.length, async ({ urls, i }) => (await runJob(c, "ios.ota", i, { urls })).output);
    const stored = succeeded(done).flatMap((o) => o.stored);
    // A download that failed is planned again with the next manifest.
    const lost = [...failures(done), ...succeeded(done).flatMap((o) => o.failed.map((f) => `ios.ota ${f.url}: ${f.error}`))];

    const { changed } = await c.step.do("record", () => recordOta(c.env, manifest, new Map(stored.map((s) => [s.url, s]))));
    if (!changed) return settle({ changed, stored: stored.length }, lost);
    const normalized = await normalizeShas(c, stored.map((s) => s.sha));
    const publish = await requestPublish(c);
    return settle({ changed, stored: stored.length, profiles: normalized.written, publish }, [...lost, ...normalized.failed]);
  }
}
