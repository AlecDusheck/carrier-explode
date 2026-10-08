/**
 * What ingest scans (SCOPE in wrangler.jsonc), a filter on new builds, never on what is held.
 */

import * as v from "valibot";

import type { ApplePlatform } from "@carrier-explode/schema/types";

const str = v.pipe(v.string(), v.minLength(1));
const count = v.pipe(v.number(), v.integer(), v.minValue(1));
/** YYYY-MM-DD. */
const day = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));

/** How builds before a family's cutoff are thinned. */
const BACKFILLS = ["releases", "quarterly", "newest"] as const;
type Backfill = (typeof BACKFILLS)[number];

/**
 * Which of a platform's OTA manifest files are fetched: `all`; `current`, the file each source serves the newest OS
 * it is listed for (no prerelease OS); or `none`.
 */
const OTA_TAKES = ["all", "current", "none"] as const;

/** Phones by the day the feeds say they came out (YYYY-MM or YYYY-MM-DD, compared as text), or a list of codes. */
const devicesSchema = v.union([
	v.object({ releasedSince: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}(-\d{2})?$/)) }),
	v.object({ codes: v.pipe(v.array(str), v.minLength(1)) }),
]);

const familySchema = <B extends Backfill>(backfills: readonly [B, ...B[]]) =>
	v.object({
		devices: devicesSchema,
		/** The cutover: builds out on or after this day are all taken, earlier ones by `backfill`. Null before one: `backfill` decides every build. */
		everythingSince: v.nullable(day),
		backfill: v.picklist(backfills),
	});

export const scopeSchema = v.object({
	/**
	 * `releases`: every release, and the newest major's betas. `newest`: each phone's newest build. No build below
	 * `minMajor`: apfs-extract cannot read iOS 17's root images.
	 */
	ios: v.object({ ...familySchema(["releases", "newest"]).entries, minMajor: count }),
	/** `quarterly`: each phone's newest build of each train (its quarterly drop's last). `newest`: each phone's newest build. */
	android: familySchema(["quarterly", "newest"]),
	/**
	 * Galaxy phones (every regional model) Google Play lists whose name starts with one of `families` and contains none of `exclude`, out since
	 * `releasedSince`. For each of the newest `majors` majors, each model's newest build of each multi-CSC package
	 * (`builds` of a major's, newest first), on each family's newest generation that has the major. A model's packages
	 * are found by asking version.xml under each of `salesCodes`, then under the first that answered for each: it
	 * answers for a sales code, never for a package's own code, and Samsung lists neither.
	 */
	samsung: v.object({
		families: v.pipe(v.array(str), v.minLength(1)),
		exclude: v.array(str),
		salesCodes: v.pipe(v.array(v.pipe(v.string(), v.regex(/^[A-Z0-9]{3}$/))), v.minLength(1)),
		releasedSince: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}$/)),
		majors: count,
		builds: v.union([v.literal("all"), count]),
	}),
	/** Which files of Apple's OTA manifest are fetched, per platform, before and after the cutoff alike. */
	appleOta: v.object({
		/** Or the iPhone files for `phones` on the newest `majors` majors the manifest lists. */
		ios: v.union([
			v.picklist(OTA_TAKES),
			v.object({ majors: count, phones: v.pipe(v.array(str), v.minLength(1)) }),
		]),
		ipados: v.picklist(OTA_TAKES),
		watchos: v.picklist(OTA_TAKES),
	}) satisfies v.GenericSchema<unknown, Record<ApplePlatform, unknown>>,
});

export type Scope = v.InferOutput<typeof scopeSchema>;
type DeviceSet = Scope["ios" | "android"]["devices"];

/** A device as the feeds record it. */
export interface DatedDevice {
	readonly code: string;
	readonly released: string;
}

const inSet = (set: DeviceSet, d: DatedDevice): boolean =>
	"codes" in set ? set.codes.includes(d.code) : d.released >= set.releasedSince;

/** The iOS feed scans iPhones. */
export const iosInScope = (scope: Scope, d: DatedDevice): boolean =>
	d.code.startsWith("iPhone") && inSet(scope.ios.devices, d);

export const pixelInScope = (scope: Scope, d: DatedDevice): boolean => inSet(scope.android.devices, d);
