/** The output of a job over many artifacts, from its per-sha outcomes. */

import type { Settled } from "../../../../src/fan-out.ts";
import type { JobOutput } from "../../../../src/jobs.ts";

export type Outcome = "written" | "skipped";

/** Failures listed in the output; `failed` counts them all. */
const LISTED_FAILURES = 50;

export function tally<I>(results: readonly Settled<Outcome, I>[], shaOf: (item: I) => string): JobOutput<"normalize"> {
  const failed = results.flatMap((r) => (r.ok ? [] : [{ sha: shaOf(r.item), error: r.error }]));
  return {
    written: results.filter((r) => r.ok && r.value === "written").length,
    skipped: results.filter((r) => r.ok && r.value === "skipped").length,
    failed: failed.length,
    failures: failed.slice(0, LISTED_FAILURES),
  };
}
