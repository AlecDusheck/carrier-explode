/** Apple bundles' own views: a bundle and its files, its phones' override files, the SIM routes to it, and the iOS modem packages. */

import * as v from "valibot";
import { query } from "$app/server";
import { modemHead } from "#lib/modem.ts";
import * as baseband from "#lib/server/apple/baseband.ts";
import * as bundle from "#lib/server/apple/bundle.ts";
import { manifestCounts, selectedBy } from "#lib/server/apple/manifest.ts";
import * as phones from "#lib/server/apple/phones.ts";
import { build, device, family, index, key, packageId, path, pinned, ver, verSchema } from "./schemas";

export const getAppleBundle = query(verSchema, bundle.getBundle);
export const getAppleFile = query(v.object({ ...pinned, path }), (a) => bundle.getFile(a, a.path));
/** An override file's modem configuration head; null for a file in Intel's dialect. */
export const getAppleModemHead = query(v.object({ ...pinned, path }), async (a) => {
	const config = await bundle.getModemConfig(a, a.path);
	return config && modemHead(config);
});
export const getAlerts = query(v.object(pinned), bundle.getAlerts);

/** The SIM routes to one Apple bundle. */
export const getSelectedBy = query(key, selectedBy);
export const getManifestCounts = query(manifestCounts);

/** An Apple version's modem override files, with the phones that read each. */
export const getBundleOverrides = query(verSchema, phones.getBundleOverrides);
export const getPhoneChanges = query(v.object({ ...pinned, against: v.exactOptional(v.string()) }), (a) =>
	phones.getPhoneChanges(a, a.against),
);
export const getOverridePlist = query(v.object({ ...pinned, path }), (a) =>
	phones.getOverridePlist(a, a.path),
);

/** An iOS build's modem packages with the phones each serves, and its Default bundle's page. */
export const getModemPackages = query(build, baseband.getModemPackages);
export const getModemPackageHeader = query(packageId, baseband.getModemPackageHeader);
export const getBaseband = query(v.object({ build, family }), (a) => baseband.getBaseband(a.build, a.family));
export const getBasebandFile = query(v.object({ id: packageId, i: index }), (a) =>
	baseband.getBasebandFile(a.id, a.i),
);
export const getBasebandCombos = query(v.object({ id: packageId, sha1: v.string(), tag: v.string() }), (a) =>
	baseband.getBasebandCombos(a.id, a.sha1, a.tag),
);
export const getBasebandDiff = query(v.object({ a: build, b: build, family }), (q) =>
	baseband.getBasebandDiff(q.a, q.b, q.family),
);
export const getBasebandDefaults = query(v.object({ ...ver, device: v.exactOptional(device) }), (a) =>
	baseband.getBasebandDefaults(a, a.device),
);
export const getBasebandOverride = query(
	v.object({ ...ver, id: packageId, pri: path, efs: path, i: index }),
	(a) => baseband.getBasebandOverride(a, a.id, a.pri, a.efs, a.i),
);
