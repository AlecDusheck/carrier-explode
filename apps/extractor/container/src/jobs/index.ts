/** Every container job by name (src/container-protocol.ts names them): one entry each. */

import type { ContainerJobName } from "../../../src/container-protocol.ts";
import type { JobRunner } from "../job.ts";
import { iosIpsw } from "./ios/ipsw/job.ts";
import { galaxyAp } from "./samsung/job.ts";

export const JOBS: { readonly [J in ContainerJobName]: JobRunner } = {
	"ios.ipsw": iosIpsw,
	"galaxy.ap": galaxyAp,
};
