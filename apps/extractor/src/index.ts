/** The extractor Worker: a Workflow per unit of work, each job a container, and the only writer of the v2 bucket. */

import { handleApi } from "./worker/api.ts";
import { scheduled } from "./worker/cron.ts";
import type { Env } from "./worker/env.ts";

export { HeavyExtractor, LightExtractor } from "./worker/extractor.ts";
export { AndroidBuildWorkflow } from "./workflows/android-build.ts";
export { IosBuildWorkflow } from "./workflows/ios-build.ts";
export { IosOtaWorkflow } from "./workflows/ios-ota.ts";
export { LabelsWorkflow } from "./workflows/labels.ts";
export { PublishWorkflow } from "./workflows/publish.ts";
export { ReindexWorkflow } from "./workflows/reindex.ts";

export default {
  fetch: handleApi,
  scheduled,
} satisfies ExportedHandler<Env>;
