/** Every job type's runner; `satisfies` checks the table is complete. */

import type { Runners } from "../job.ts";
import { androidModem } from "./android-modem/index.ts";
import { androidOta } from "./android-ota.ts";
import { androidRelease } from "./android-release.ts";
import { iosOta } from "./ios-ota.ts";
import { runIpsw } from "./ios/ipsw/job.ts";
import { runModems } from "./ios/modems/job.ts";
import { runRelease } from "./ios/release/job.ts";
import { modemSummaries } from "./modem-summaries.ts";
import { normalize } from "./normalize.ts";
import { publish } from "./publish.ts";

export const RUNNERS = {
  "ios.ipsw": runIpsw,
  "ios.modems": runModems,
  "ios.release": runRelease,
  "ios.ota": iosOta,
  "ios.modem-summaries": modemSummaries,
  "android.ota": androidOta,
  "android.modem": androidModem,
  "android.release": androidRelease,
  normalize,
  publish,
} as const satisfies Runners;
