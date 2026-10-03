/** Android native views: one canonical carrier's CarrierSettings at a version. */

import * as v from "valibot";
import { query } from "$app/server";
import * as android from "#lib/server/android.ts";
import { at, pinned, slug } from "./schemas";

export const getAndroid = query(v.object(at), (a): Promise<android.AndroidVersion> => android.getAndroid(a.source, a.slug));
export const getAndroidSettings = query(v.object(pinned), (a): Promise<android.ConfigGroup[]> => android.getAndroidSettings(a.source, a.slug));
export const getAndroidApns = query(v.object(pinned), (a): Promise<android.ShownApn[]> => android.getAndroidApns(a.source, a.slug));
export const getAndroidRaw = query(v.object(pinned), (a): Promise<android.AndroidRaw> => android.getAndroidRaw(a.source, a.slug));
export const getAndroidChanges = query(v.object({ ...pinned, against: v.exactOptional(slug) }), (a): Promise<android.AndroidChanges> =>
  android.getAndroidChanges(a.source, a.slug, a.against));
