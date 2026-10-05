/** Which of an Android version's tabs it has something for, with the counts of what it holds. */

import { getAndroid } from "#lib/api/android.remote.ts";
import { verArgs } from "#lib/format.ts";
import type { At } from "#lib/types.ts";
import type { Holds } from "../views.ts";

export async function androidHolds(at: At): Promise<Holds> {
  const v = await getAndroid(verArgs(at));
  return { settings: v.counts.configs, apns: v.counts.apns, modem: v.counts.modems > 0, files: true, changes: v.previous !== null };
}
