/** Argument schemas the remote queries share. */

import * as v from "valibot";
import { sha256Schema, sourceKeySchema } from "@carrier-explode/schema/records";
import {
	DEVICE_CODE,
	ISO_CODE,
	isVersionSlug,
	PLATFORMS,
	RELEASE_ID,
	SOURCE_KINDS,
} from "@carrier-explode/schema/types";
import type { Ver } from "#lib/types.ts";

/** A source key: `ios:carrier:ATT_US`, as a URL spells it. */
export const key = sourceKeySchema;

/** A version segment: `72.0`, `50.1@2022-04-12`. */
export const slug = v.pipe(v.string(), v.check(isVersionSlug, "not a version"));

/** A source's line: a Pixel codename, a Galaxy model (SM-S931B), or a model-specific Apple bundle's product type. */
const line = v.pipe(v.string(), v.regex(DEVICE_CODE));

/** A version as a URL names it; without `slug`, the line's head. */
export const ver = { source: key, line: v.exactOptional(line), slug: v.exactOptional(slug) };
export const verSchema = v.object(ver) satisfies v.GenericSchema<unknown, Ver>;

/** A version a tab is pinned to. */
export const pinned = { source: key, line: v.exactOptional(line), slug };

export const platform = v.picklist(PLATFORMS);

/** The scan scopes that cover a whole platform: every carrier, or every country bundle. */
const WHOLE_SCOPES = ["carriers", "countries"] as const;
export type WholeScope = (typeof WHOLE_SCOPES)[number];

const oneCountry = v.custom<`country:${string}`>(
	(s) => typeof s === "string" && s.startsWith("country:") && ISO_CODE.test(s.slice("country:".length)),
	"not a country scope",
);
/** Which sources a scan reads: a whole platform's, or one country's carriers. */
export const scanScope = v.union([v.picklist(WHOLE_SCOPES), oneCountry]);
export type ScanScope = v.InferOutput<typeof scanScope>;

export const kind = v.picklist(SOURCE_KINDS);
export const iso = v.pipe(v.string(), v.regex(ISO_CODE));

/** A release id: an iOS build (24A437) or an Android build id (CP3A.260905.009). */
export const release = v.pipe(v.string(), v.regex(RELEASE_ID));

/** An image build: 24A437. */
export const build = v.pipe(v.string(), v.regex(/^\w{3,16}$/));

/** A modem package, by the SHA-256 it is stored under. */
export const packageId = sha256Schema;

/** A modem family: Mav25, c4000. */
export const family = v.pipe(v.string(), v.regex(/^\w{1,16}$/));

/** A product type: iPhone18,1. */
export const device = v.pipe(v.string(), v.regex(/^[A-Za-z]+\d+,\d+$/));

export const index = v.pipe(v.number(), v.integer());

/** A path inside a bundle, or a key path inside a file. */
export const path = v.pipe(v.string(), v.maxLength(1024));

/** A phone a page can be read for: an iPhone product type (iPhone18,1), a Pixel codename (tokay) or a Galaxy model (SM-S931B). */
export const phone = v.pipe(
	v.string(),
	v.regex(/^(?:[A-Za-z]+\d+,\d+|[a-z][a-z0-9_]{1,30}|SM-[A-Z0-9]{2,12})$/),
);

/** Where a modem configuration is read: a stored one by its sha, or an iPhone bundle's override file. */
const modemConfigRef = v.variant("kind", [
	v.object({ kind: v.literal("stored"), sha: packageId }),
	v.object({ kind: v.literal("bundle"), ...pinned, path }),
]);
export type ModemConfigRef = v.InferOutput<typeof modemConfigRef>;

/** A modem configuration's settings that match a filter, as typed. */
export const modemItemsQuery = v.object({
	ref: modemConfigRef,
	filter: v.pipe(v.string(), v.maxLength(200)),
});
export type ModemItemsQuery = v.InferOutput<typeof modemItemsQuery>;

/** One page of them from the `from`th, in one section (an EFS directory, a module) or all. */
export const modemPageQuery = v.object({
	...modemItemsQuery.entries,
	section: v.nullable(v.pipe(v.string(), v.maxLength(1024))),
	from: v.pipe(index, v.minValue(0)),
});
export type ModemPageQuery = v.InferOutput<typeof modemPageQuery>;

const LIST_SORTS = ["newest", "name"] as const;
export const LIST_PAGE = 100;
/** A list's `?from=`, which pages it without JavaScript; null, for anything but a row number, opens it around the page open beside it. */
export const listFrom = v.fallback(v.nullable(v.pipe(v.string(), v.toNumber(), index, v.minValue(0))), null);

/** A page of a list's rows that match `q`, from the `from`th; with no `from`, around the row of `reach`, the page open beside the list. */
export const listPageQuery = v.object({
	platform,
	kind,
	q: v.pipe(v.string(), v.maxLength(200)),
	sort: v.picklist(LIST_SORTS),
	from: v.nullable(v.pipe(index, v.minValue(0))),
	reach: v.nullable(path),
});
export type ListPageQuery = v.InferOutput<typeof listPageQuery>;

/** A visitor's guess as a list's search reads it: the carrier only when it is their network's. */
export const listGuessQuery = v.object({
	platform,
	kind,
	carrier: v.nullable(v.pipe(v.string(), v.maxLength(200))),
	country: v.nullable(iso),
});
export type ListGuessQuery = v.InferOutput<typeof listGuessQuery>;
