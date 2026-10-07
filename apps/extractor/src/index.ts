/** The extractor Worker: feed checks start a Workflow instance per unit; each unit extracts to R2 and queues its records, which the index queue's consumer writes into D1. */

import type { Env } from "./env.ts";
import { handleApi } from "./http.ts";
import { queue } from "./queues.ts";
import { scheduled } from "./runs.ts";

// The Extractor class's outbound proxy, which serves its containers' bucket requests.
export { ContainerProxy } from "@cloudflare/containers";
export { IosBuildWorkflow, AppleOtaWorkflow } from "./apple/workflows.ts";
export { Extractor } from "./container.ts";
export { GalaxyBuildWorkflow } from "./galaxy/workflows.ts";
export { PixelDeviceWorkflow, PixelOtaWorkflow } from "./pixel/workflows.ts";
export { LabelsWorkflow, ReindexWorkflow } from "./workflows.ts";
export { DatasetWorkflow } from "./dataset/workflow.ts";

export default {
	fetch: handleApi,
	scheduled,
	queue,
} satisfies ExportedHandler<Env>;
