/**
 * The Android jobs, as the runner registry (./index.ts) imports them:
 * android.plan (which builds) -> android.ota per device -> android.release per build.
 */

import type { RunnerTable } from "../job.ts";
import { androidOta } from "./android-ota.ts";
import { androidPlan } from "./android-plan.ts";
import { androidRelease } from "./android-release.ts";

export const androidRunners: RunnerTable<"android.plan" | "android.ota" | "android.release"> = {
  "android.plan": androidPlan,
  "android.ota": androidOta,
  "android.release": androidRelease,
};
