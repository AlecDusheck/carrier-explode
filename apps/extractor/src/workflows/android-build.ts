/** One Pixel build: every device's OTA and modem (both differ per device), its release once all are in, then profiles and a publish. */

import * as v from "valibot";

import type { Json } from "@carrier-explode/schema/types";
import { describe } from "../errors.ts";
import { failures, fanOut, succeeded } from "../fan-out.ts";
import { PIPELINES } from "../worker/pipelines.ts";
import { runJob, type RunContext } from "../worker/run-job.ts";
import { Pipeline, settle } from "./pipeline.ts";
import { normalizeShas, requestPublish } from "./tail.ts";

export class AndroidBuildWorkflow extends Pipeline {
  protected async steps(c: RunContext, payload: unknown): Promise<Json> {
    const b = v.parse(PIPELINES["android-build"].params, payload);
    const read = await fanOut(b.devices, b.devices.length, async ({ device, url }) => {
      const params = { build: b.build, device, url };
      // Settled, not Promise.all: a failure must not leave the other job running unawaited.
      const [ota, modem] = await Promise.allSettled([runJob(c, "android.ota", device, params), runJob(c, "android.modem", device, params)]);
      if (ota.status === "rejected" || modem.status === "rejected") {
        throw new Error([ota, modem].flatMap((r) => (r.status === "rejected" ? [describe(r.reason)] : [])).join(" | "));
      }
      return { ota: ota.value, modem: modem.value };
    });
    const lost = failures(read);
    if (lost.length) return settle({}, lost);

    const done = succeeded(read);
    // A build only for the Pixel Tablet ships no carrier settings: nothing to index.
    if (done.every((d) => d.ota.output.carrierList === null)) return settle({ build: b.build, carrierSettings: false }, []);
    await runJob(c, "android.release", b.build, {
      build: b.build, version: b.version, patch: b.patch, parts: done.map((d) => d.ota.id), modems: done.map((d) => d.modem.id),
    });
    const shas = done.flatMap(({ ota, modem }) => [...ota.output.files.map((f) => f.sha), ...Object.values(modem.output.modem?.configs ?? {})]);
    const normalized = await normalizeShas(c, shas);
    const publish = await requestPublish(c);
    return settle({ build: b.build, profiles: normalized.written, publish }, normalized.failed);
  }
}
