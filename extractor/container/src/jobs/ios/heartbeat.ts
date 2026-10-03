/** Keeps a container awake through a step that reports nothing itself, by calling ctx.progress on a timer. */

import type { JobContext } from "../../job.ts";

const EVERY_MS = 60_000;

export async function withHeartbeat<T>(ctx: Pick<JobContext, "progress" | "log">, note: string, fn: () => Promise<T>): Promise<T> {
  let beats = 0;
  // A step of unknown length: `done` counts minutes, `total` stays one ahead so it never reads as finished.
  const timer = setInterval(() => {
    beats++;
    ctx.progress(beats, beats + 1, note).catch((e: unknown) => ctx.log(`progress failed: ${e instanceof Error ? e.message : String(e)}`));
  }, EVERY_MS);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}
