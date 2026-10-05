/** A deterministic slice of sha space, for jobs that run in parallel over every artifact. */
export const inShard = (sha: string, { shard, of }: { readonly shard: number; readonly of: number }): boolean =>
  Number.parseInt(sha.slice(0, 8), 16) % of === shard;
