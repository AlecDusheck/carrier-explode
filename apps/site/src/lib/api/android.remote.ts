/** Android versions: one canonical carrier's CarrierSettings on one Pixel line. */

import * as v from "valibot";
import { query } from "$app/server";
import { DEVICE_RELEASE_PLATFORMS } from "@carrier-explode/schema/types";
import * as android from "#lib/server/android/settings.ts";
import * as modems from "#lib/server/android/modems.ts";
import { packageId, path, phone, pinned, release, slug } from "./schemas";

const args = v.object(pinned);

export const getAndroid = query(args, android.getAndroid);
export const getAndroidSettings = query(args, android.getAndroidSettings);
export const getAndroidApns = query(args, android.getAndroidApns);
export const getAndroidModems = query(args, modems.getAndroidModems);
export const getAndroidFiles = query(args, android.getAndroidFiles);
export const getAndroidSelectedBy = query(args, android.getAndroidSelectedBy);
export const getAndroidFile = query(v.object({ ...pinned, path }), (a) => android.getAndroidFile(a, a.path));
export const getModemFirmware = query(
	v.object({ platform: v.picklist(DEVICE_RELEASE_PLATFORMS), build: release, device: phone }),
	(a) => modems.getModemFirmware(a.platform, a.build, a.device),
);
/** A stored ModemConfig's head, by the sha that names it as packageId names an artifact. */
export const getModemHead = query(packageId, modems.getModemHead);
/** A ComboSet's list, by its key. */
export const getModemCombos = query(packageId, modems.getModemCombos);
export const getAndroidChanges = query(v.object({ ...pinned, against: v.exactOptional(slug) }), (a) =>
	android.getAndroidChanges(a, a.against),
);
