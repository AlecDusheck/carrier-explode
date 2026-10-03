/**
 * The extractor Worker: Workflows that drive Cloudflare Containers, and the
 * only writer of the v2 bucket. See README.md and docs/architecture-v2.md.
 */

import { handleApi } from "./worker/api.ts";
import { scheduled } from "./worker/cron.ts";
import type { Env } from "./worker/env.ts";

// Outbound interception (r2.internal, control.internal) dispatches through this entrypoint.
export { ContainerProxy } from "@cloudflare/containers";
export { HeavyExtractor, LightExtractor } from "./worker/extractor.ts";
export { AndroidPipeline } from "./pipelines/android.ts";
export { IndexPipeline } from "./pipelines/index-only.ts";
export { IosImagesPipeline } from "./pipelines/ios-images.ts";
export { IosOtaPipeline } from "./pipelines/ios-ota.ts";
export { ReindexPipeline } from "./pipelines/reindex.ts";

export default {
  fetch: handleApi,
  scheduled,
} satisfies ExportedHandler<Env>;
