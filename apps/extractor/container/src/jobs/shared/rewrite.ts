import type { StoredHead } from "../../job.ts";

/** A stored output stands unless a reindex rewrites what was written before it began: so a retried attempt keeps what the last one wrote. */
export const stands = (stored: StoredHead | null, rewriteBefore: string | undefined): boolean =>
  stored !== null && (rewriteBefore === undefined || stored.uploaded >= new Date(rewriteBefore));
