/** Apple's OTA manifest, every 30 minutes: archive what is new; publish only when something changed. */

import * as v from "valibot";

import type { Json } from "../../../src/lib/schema/types.ts";
import { PIPELINES } from "../worker/pipelines.ts";
import { runJob, type RunContext } from "../worker/run-job.ts";
import { Pipeline, settle } from "./pipeline.ts";
import { normalizeShas, publish } from "./publish.ts";

export class IosOtaPipeline extends Pipeline {
  protected readonly pipeline = "ios-ota";

  protected async steps(c: RunContext, payload: unknown): Promise<Json> {
    const archive = (await runJob(c, "ios.ota-archive", "archive", v.parse(PIPELINES["ios-ota"].params, payload))).output;
    if (!archive.changed) return { changed: false, refs: archive.refs };
    const normalized = await normalizeShas(c, archive.shas);
    const published = await publish(c, { force: false });
    return settle(
      { changed: true, refs: archive.refs, archived: archive.archived, profiles: normalized.written, carriers: published.index.carriers },
      normalized.failed,
    );
  }
}
