/** The two container classes: one image, two sizes. A container runs the job JOB_ID names (its spec is in R2) and exits; R2 is reached over its S3 API. */

import { Container } from "@cloudflare/containers";

import type { Env } from "./env.ts";

const JOB = "job";
const UP: ReadonlySet<string> = new Set(["running", "healthy", "stopping"]);

abstract class Extractor extends Container<Env> {
  /** Longer than any job's timeout: the container stops when its job exits, or when its Workflow gives up on it. */
  override sleepAfter = "3h";
  /** Downloads from Apple and Google, and R2's S3 endpoint. */
  override enableInternet = true;

  /** Starts job `id` unless the container is up; true when the job it runs is `id`. */
  async run(id: string): Promise<boolean> {
    if (await this.up()) return (await this.ctx.storage.get(JOB)) === id;
    await this.ctx.storage.put(JOB, id);
    const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = this.env;
    await this.start({ envVars: { JOB_ID: id, R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } });
    return true;
  }

  async up(): Promise<boolean> {
    return UP.has((await this.getState()).status);
  }

  /** The id of the job the container is running; null when it is not up. */
  async running(): Promise<string | null> {
    if (!(await this.up())) return null;
    const id: unknown = await this.ctx.storage.get(JOB);
    return typeof id === "string" ? id : null;
  }
}

/** standard-4: 4 vCPU, 12 GiB, 20 GB disk. ios.ipsw only (a multi-GB IPSW plus its unpacked filesystem). */
export class HeavyExtractor extends Extractor {}
/** standard-1: ½ vCPU, 4 GiB, 8 GB disk. Everything else. */
export class LightExtractor extends Extractor {}
