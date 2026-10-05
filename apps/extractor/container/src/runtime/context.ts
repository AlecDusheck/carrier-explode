/** JobContext over the runtime: writes held to the job's scope (JOBS in src/jobs.ts), progress logged at most every PROGRESS_MS. */

import { JOBS, type JobSpec, type JobTraits, type JobType } from "../../../src/jobs.ts";
import type { JobContext, R2Client } from "../job.ts";

const PROGRESS_MS = 30_000;

export interface Deps {
  readonly r2: R2Client;
  readonly log: (line: string) => void;
}

/** Throws unless `key` is under one of `prefixes`: a write outside its job's scope is a bug in the job. */
function within(key: string, verb: "write" | "delete", prefixes: readonly string[]): string {
  if (!prefixes.some((p) => key.startsWith(p))) throw new Error(`${key}: this job may not ${verb} it (only under ${prefixes.join(", ") || "nothing"})`);
  return key;
}

function scoped(r2: R2Client, { writes, deletes }: JobTraits): R2Client {
  return {
    ...r2,
    put: async (key, body, contentType) => r2.put(within(key, "write", writes), body, contentType),
    putJson: async (key, value) => r2.putJson(within(key, "write", writes), value),
    delete: async (key) => r2.delete(within(key, "delete", deletes)),
    putObj: async (body, claim) => {
      within("obj/", "write", writes);
      return r2.putObj(body, claim);
    },
  };
}

export function createContext<T extends JobType>(spec: JobSpec<T>, tmp: string, deps: Deps): JobContext<T> {
  const log = (message: string): void => deps.log(`[${spec.id}] ${message}`);
  let loggedAt = 0;
  return {
    spec,
    tmp,
    r2: scoped(deps.r2, JOBS[spec.type]),
    log,
    async progress(done, total, note) {
      if (done < total && Date.now() - loggedAt < PROGRESS_MS) return;
      loggedAt = Date.now();
      log(`${done}/${total}${note === undefined ? "" : ` ${note}`}`);
    },
  };
}
