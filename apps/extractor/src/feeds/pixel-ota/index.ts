/** The Pixel OTA feed: every general build since CarrierSettings shipped, one OTA per device, minus what releases already hold. */

import type * as v from "valibot";

import type { androidBuildSchema } from "../../jobs.ts";
import type { Env } from "../../worker/env.ts";
import type { FeedOptions } from "../../worker/pipelines.ts";
import { indexDb } from "@carrier-explode/db/d1";
import { syncFeedDevices } from "../devices.ts";
import { heldAndroid } from "../held.ts";
import { fetchFirstPatches } from "./build-numbers.ts";
import { delisted, pixelDevices } from "./devices.ts";
import { fetchOtaPage, OTA_PAGE } from "./page.ts";
import { planBuilds } from "./plan.ts";

export interface PixelCheck {
  /** Newest first. */
  readonly builds: Array<v.InferOutput<typeof androidBuildSchema>>;
  /** Held builds the OTA page no longer lists for some of their devices; the releases stay. */
  readonly delisted: readonly string[];
}

export async function checkPixel(env: Env, o: FeedOptions<"android">): Promise<PixelCheck> {
  const [page, firstPatches] = await Promise.all([fetchOtaPage(), fetchFirstPatches()]);
  // Google heads each phone's section with its name, and its builds date it: pages name and order Pixels from the feed.
  await syncFeedDevices(env, { evidence: OTA_PAGE, names: page.map((d) => ({ code: d.device, value: d.name })), records: pixelDevices(page, firstPatches) });
  const held = await heldAndroid(indexDb(env.DB));
  const gone = delisted(page, held);
  if (gone.length) console.warn(`the OTA page no longer lists ${gone.length} held builds for some of their devices: ${gone.join("; ")}`);
  return { builds: planBuilds(page, new Map(held.map((r) => [r.id, new Set(r.devices)])), o.rebuild ?? false).reverse(), delisted: gone };
}
