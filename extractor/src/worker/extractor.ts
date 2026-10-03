/**
 * The two container classes: one image, two sizes. Each Durable Object runs
 * exactly one job (its name is the job id) and remembers it, which is what
 * lets the outbound handlers scope a container's R2 writes and route its
 * /done to the right Workflow instance.
 */

import { Container } from "@cloudflare/containers";

import type { Progress } from "../jobs.ts";
import type { Env } from "./env.ts";
import { parseLaunch, type Launch } from "./launch.ts";
import { OUTBOUND } from "./outbound.ts";

const PORT = 8080;
const LAUNCH = "launch";

abstract class Extractor extends Container<Env> {
  override defaultPort = PORT;
  /**
   * Long, because whether the container's own outbound traffic counts as
   * activity is undocumented: jobs heartbeat through control.internal
   * /progress, which renews this explicitly (heartbeat below).
   */
  override sleepAfter = "30m";
  /** Upstream downloads (IPSWs, OTAs, Apple) go direct; only *.internal is intercepted. */
  override enableInternet = true;

  /**
   * Starts the container and hands it the job. Safe to repeat for the same
   * job (a retried Workflow step): the runtime answers 202 again for the job
   * it is already running.
   */
  async launch(launch: Launch): Promise<void> {
    await this.ctx.storage.put(LAUNCH, launch);
    await this.startAndWaitForPorts({
      ports: PORT,
      startOptions: { envVars: { JOB_ID: launch.spec.id } },
      cancellationOptions: { portReadyTimeoutMS: 180_000 },
    });
    const res = await this.containerFetch(
      "http://container/run",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(launch.spec) },
      PORT,
    );
    if (res.status !== 202) throw new Error(`container refused ${launch.spec.id}: HTTP ${res.status} ${await res.text()}`);
  }

  /** The job, for an outbound call from this container; renews the idle timer, since the call is activity. */
  async checkIn(): Promise<Launch | null> {
    this.renewActivityTimeout();
    return this.record();
  }

  async heartbeat(progress: Progress): Promise<void> {
    this.renewActivityTimeout();
    const launch = await this.record();
    if (launch) await this.ctx.storage.put(LAUNCH, { ...launch, progress: { ...progress, at: new Date().toISOString() } });
  }

  async finished(): Promise<void> {
    const launch = await this.record();
    if (launch) await this.ctx.storage.put(LAUNCH, { ...launch, finishedAt: new Date().toISOString() });
  }

  async record(): Promise<Launch | null> {
    const raw: unknown = await this.ctx.storage.get(LAUNCH);
    return raw === undefined ? null : parseLaunch(raw);
  }
}

/** standard-4: 4 vCPU, 12 GiB, 20 GB disk. ios.ipsw only (a multi-GB IPSW plus its unpacked filesystem). */
export class HeavyExtractor extends Extractor {}
/** standard-1: ½ vCPU, 4 GiB, 8 GB disk. Everything else. */
export class LightExtractor extends Extractor {}

// Through the static setter, which files handlers under the class name: a
// `static outboundByHost =` field would shadow it and register nothing.
HeavyExtractor.outboundByHost = OUTBOUND;
LightExtractor.outboundByHost = OUTBOUND;

export type ExtractorClass = "HeavyExtractor" | "LightExtractor";
