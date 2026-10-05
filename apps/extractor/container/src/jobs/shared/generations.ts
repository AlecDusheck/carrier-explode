/** Published generations (index/, scan/): what is left once a pointer flips. */

import { allOrThrow, fanOut } from "../../../../src/fan-out.ts";
import type { R2Client } from "../../job.ts";
import { READ_CONCURRENCY } from "./limits.ts";

/** Deletes everything under `prefix` but the pointer and the kept generations: older ones, and those of runs that died before their flip. */
export async function dropStale(r2: R2Client, prefix: string, pointer: string, kept: readonly string[]): Promise<number> {
  const stale = (await r2.list(prefix)).filter((k) => k !== pointer && !kept.some((p) => k.startsWith(p)));
  allOrThrow("stale objects", await fanOut(stale, READ_CONCURRENCY, (k) => r2.delete(k)));
  return stale.length;
}
