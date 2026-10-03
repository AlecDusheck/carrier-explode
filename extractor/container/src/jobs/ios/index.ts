/**
 * The iOS image jobs, for the container's registry (../index.ts):
 *
 *   ios.plan     which builds to extract, each with every iPhone IPSW      ./plan/job.ts
 *   ios.ipsw     one IPSW's carrier and country bundles (heavy)            ./ipsw/job.ts
 *   ios.modems   a build's modem packages, over Range requests             ./modems/job.ts
 *   ios.release  the build's IPSWs merged, releases/ios/<build>.json       ./release/job.ts
 *
 * ./shared/ holds what is iOS-generic rather than job logic (LZFSE, .ipcc
 * packaging, BuildManifest), bound for the iOS decoder package.
 */

import type { RunnerTable } from "../../job.ts";
import { runIpsw } from "./ipsw/job.ts";
import { runModems } from "./modems/job.ts";
import { runPlan } from "./plan/job.ts";
import { runRelease } from "./release/job.ts";

export const iosRunners: RunnerTable<"ios.plan" | "ios.ipsw" | "ios.modems" | "ios.release"> = {
  "ios.plan": runPlan,
  "ios.ipsw": runIpsw,
  "ios.modems": runModems,
  "ios.release": runRelease,
};
