/** Android versions: one canonical carrier's CarrierSettings on one Pixel line. */

import * as v from "valibot";
import { query } from "$app/server";
import * as android from "#lib/server/android.ts";
import { pinned, slug } from "./schemas";

const args = v.object(pinned);

export const getAndroid = query(args, (a): Promise<android.AndroidVersion> => android.getAndroid(a));
export const getAndroidSettings = query(args, (a): Promise<android.ConfigGroup[]> => android.getAndroidSettings(a));
export const getAndroidApns = query(args, (a): Promise<android.ShownApn[]> => android.getAndroidApns(a));
export const getAndroidFiles = query(args, (a): Promise<android.AndroidFiles> => android.getAndroidFiles(a));
export const getAndroidChanges = query(v.object({ ...pinned, against: v.exactOptional(slug) }), (a): Promise<android.AndroidChanges> =>
  android.getAndroidChanges(a, a.against));
