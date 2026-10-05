/** What a feed check says about devices: their names and records into D1, and a publish when that changed anything, as only a publish puts it on the pages. */

import type { ListedDevice } from "@carrier-explode/db";
import { indexDb, syncDevices, syncLabels } from "@carrier-explode/db/d1";
import type { Label } from "@carrier-explode/schema/records";
import type { Env } from "../worker/env.ts";
import { createRun, publishRun } from "../worker/workflows.ts";

export interface FeedDevices {
  /** The page the names were read from. */
  readonly evidence: string;
  readonly names: ReadonlyArray<Pick<Label, "code" | "value">>;
  readonly records: readonly ListedDevice[];
}

/** The publish id when one was started. */
export async function syncFeedDevices(env: Env, feed: FeedDevices): Promise<string | null> {
  const db = indexDb(env.DB);
  const now = new Date();
  const named = await syncLabels(db, "device", "name", feed.names, feed.evidence, now.toISOString());
  const recorded = await syncDevices(db, feed.records, now.toISOString());
  if (named + recorded === 0) return null;
  const run = publishRun(now, false);
  await createRun(env, run);
  return run.id;
}
