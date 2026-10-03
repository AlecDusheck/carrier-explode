/**
 * Every job type's runner. The iOS ingest and Android runners live with their
 * own agents' code; this file only assembles the table, and `satisfies`
 * checks it covers every JobType with the right signature.
 */

import type { Registry } from "../runtime/execute.ts";
import { androidRunners } from "./android.ts";
import { buildIndex } from "./build-index.ts";
import { iosRunners } from "./ios/index.ts";
import { normalize } from "./normalize.ts";
import { otaArchive } from "./ota-archive/index.ts";
import { scan } from "./scan.ts";

export const RUNNERS = {
  ...iosRunners,
  ...androidRunners,
  "ios.ota-archive": otaArchive,
  normalize,
  index: buildIndex,
  scan,
} as const satisfies Registry;
