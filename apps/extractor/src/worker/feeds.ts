/**
 * Feed checks: a fetch and a diff in the Worker, then the first FEED_WINDOWS[feed] of what it plans that has not finished is kept
 * running. An instance is named by what it extracts, so a unit is never started twice; a failed one stays failed until
 * a check asks to rerun.
 */

import { checkOta } from "../feeds/apple-ota/index.ts";
import { checkIpsw } from "../feeds/apple-ipsw/index.ts";
import { checkPixel } from "../feeds/pixel-ota/index.ts";
import type { Env } from "./env.ts";
import { instanceId } from "./ids.ts";
import type { FeedName, FeedOptions } from "./pipelines.ts";
import { createRun, workflowOf, type Run } from "./workflows.ts";

/** A feed and what its check is asked. */
export type FeedCheck = { readonly [F in FeedName]: { readonly feed: F; readonly options: FeedOptions<F> } }[FeedName];

export interface Checked {
  readonly started: readonly string[];
  readonly live: readonly string[];
  readonly failed: readonly string[];
  /** Held builds the feed no longer lists: what a purge of the feed's took, though the releases stay. */
  readonly delisted: readonly string[];
}

type Status = InstanceStatus["status"];
const LIVE: ReadonlySet<Status> = new Set<Status>(["queued", "running", "paused", "waiting", "waitingForPause"]);
const FAILED: ReadonlySet<Status> = new Set<Status>(["errored", "terminated"]);

/** What the feed would extract, most wanted first, whether finished ones run again, and what it no longer lists. */
async function plan(env: Env, f: FeedCheck): Promise<{ readonly runs: readonly Run[]; readonly rerun: boolean; readonly delisted: readonly string[] }> {
  switch (f.feed) {
    case "ios-images":
      return {
        runs: (await checkIpsw(env, f.options)).map((params) => ({ pipeline: "ios-build", id: instanceId("ios-build", params.build), params })),
        rerun: f.options.rebuild ?? false,
        delisted: [],
      };
    case "ios-ota": {
      const params = await checkOta(env);
      return { runs: params ? [{ pipeline: "ios-ota", id: instanceId("ios-ota", params.manifest), params }] : [], rerun: false, delisted: [] };
    }
    case "android": {
      const checked = await checkPixel(env, f.options);
      return {
        runs: checked.builds.map((params) => ({ pipeline: "android-build", id: instanceId("android-build", params.build), params })),
        rerun: f.options.rebuild ?? false,
        delisted: checked.delisted,
      };
    }
  }
}

/** The instance's status; null when there is none. */
async function statusOf(env: Env, run: Run): Promise<Status | null> {
  try {
    return (await (await workflowOf(env, run.pipeline).get(run.id)).status()).status;
  } catch (e) {
    if (e instanceof Error && /not.?found/i.test(e.message)) return null;
    throw e;
  }
}

export async function checkFeed(env: Env, f: FeedCheck): Promise<Checked> {
  const { runs, rerun, delisted } = await plan(env, f);
  const started: string[] = [];
  const live: string[] = [];
  const failed: string[] = [];
  for (const run of runs) {
    if (started.length + live.length >= env.FEED_WINDOWS[f.feed]) break;
    const status = await statusOf(env, run);
    if (status === null) {
      await createRun(env, run);
      started.push(run.id);
    } else if (LIVE.has(status)) {
      live.push(run.id);
    } else if (rerun) {
      await (await workflowOf(env, run.pipeline).get(run.id)).restart();
      started.push(run.id);
    } else if (FAILED.has(status)) {
      failed.push(run.id);
    }
  }
  return { started, live, failed, delisted };
}
