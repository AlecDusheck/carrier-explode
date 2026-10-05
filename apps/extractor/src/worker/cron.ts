/** Cron checks the feeds due now (it runs under a 15-minute cap), and starts the week's labels run. */

import type { Env } from "./env.ts";
import { checkFeed } from "./feeds.ts";
import { timedInstanceId } from "./ids.ts";
import { FEED_NAMES, FEEDS, LABELS_CRON } from "./pipelines.ts";
import { createRun } from "./workflows.ts";

export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  if (controller.cron === LABELS_CRON) {
    await createRun(env, { pipeline: "labels", id: timedInstanceId("labels", new Date()), params: {} });
    return;
  }
  const due = FEED_NAMES.filter((f) => FEEDS[f].cron === controller.cron);
  if (!due.length) throw new Error(`no feed is checked at "${controller.cron}"`);
  const checked = await Promise.allSettled(due.map((feed) => checkFeed(env, { feed, options: {} })));
  const failed = checked.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
  if (failed.length) throw new AggregateError(failed, `cron ${controller.cron}: ${failed.length} feed check(s) failed`);
}
