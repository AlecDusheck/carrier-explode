/** Android versions of a page: one canonical carrier's CarrierSettings. */

import * as v from "valibot";
import { query } from "$app/server";
import * as android from "#lib/server/android.ts";
import { onPlatform } from "#lib/server/at.ts";
import { pinned, slug } from "./schemas";

const args = v.object(pinned);

/** The Android source of a page at a version: every Android query is pinned, since the strip always names one. */
const at = (a: v.InferOutput<typeof args>): Promise<{ source: string }> => onPlatform("android", a.kind, a.name, a.slug);

export const getAndroid = query(args, async (a): Promise<android.AndroidVersion> => android.getAndroid((await at(a)).source, a.slug));
export const getAndroidSettings = query(args, async (a): Promise<android.ConfigGroup[]> =>
  android.getAndroidSettings((await at(a)).source, a.slug));
export const getAndroidApns = query(args, async (a): Promise<android.ShownApn[]> => android.getAndroidApns((await at(a)).source, a.slug));
export const getAndroidRaw = query(args, async (a): Promise<android.AndroidRaw> => android.getAndroidRaw((await at(a)).source, a.slug));
export const getAndroidChanges = query(v.object({ ...pinned, against: v.exactOptional(slug) }), async (a): Promise<android.AndroidChanges> =>
  android.getAndroidChanges((await at(a)).source, a.slug, a.against));
