/** Argument schemas the remote queries share. Every argument arrives from the client, so each is checked here. */

import * as v from "valibot";
import { sha256Schema } from "@carrier-explode/schema/records";
import { isSourceKey, isVersionSlug, PLATFORMS, SOURCE_KINDS, type SourceKey } from "@carrier-explode/schema/types";
import { ISO_CODE, type Ver } from "#lib/types.ts";

/** A source key: `ios:carrier:ATT_US`, as a URL spells it. */
const source = v.pipe(v.string(), v.check(isSourceKey, "not a source key"));

/** A source key, typed as one. */
export const key = v.custom<SourceKey>((x) => typeof x === "string" && isSourceKey(x), "not a source key");

/** A version segment: `72.0`, `50.1@2022-04-12`. */
export const slug = v.pipe(v.string(), v.check(isVersionSlug, "not a version"));

/** A source's line: a Pixel codename, or a model-specific Apple bundle's product type. */
export const line = v.pipe(v.string(), v.regex(/^[\w,]{1,40}$/));

/** A version as a URL names it; without `slug`, the line's head. */
export const ver = { source, line: v.exactOptional(line), slug: v.exactOptional(slug) };
export const verSchema = v.object(ver) satisfies v.GenericSchema<unknown, Ver>;

/** A version a tab is pinned to. */
export const pinned = { source, line: v.exactOptional(line), slug };

export const platform = v.picklist(PLATFORMS);

export const kind = v.picklist(SOURCE_KINDS);
export const iso = v.pipe(v.string(), v.regex(ISO_CODE));

/** A release id: an iOS build (24A437) or an Android build id (CP3A.260905.009). */
export const release = v.pipe(v.string(), v.regex(/^[\w.]{3,40}$/));

/** An image build: 24A437. */
export const build = v.pipe(v.string(), v.regex(/^\w{3,16}$/));

/** A modem package, by the SHA-256 it is stored under. */
export const packageId = sha256Schema;

/** A modem family: Mav25, C1. */
export const family = v.pipe(v.string(), v.regex(/^\w{1,16}$/));

/** A product type: iPhone18,1. */
export const device = v.pipe(v.string(), v.regex(/^[A-Za-z]+\d+,\d+$/));

export const index = v.pipe(v.number(), v.integer());

/** A path inside a bundle, or a key path inside a file. */
export const path = v.pipe(v.string(), v.maxLength(1024));

/** A phone a page can be read for: an iPhone product type (iPhone18,1) or a Pixel codename (tokay). */
export const phone = v.pipe(v.string(), v.regex(/^(?:[A-Za-z]+\d+,\d+|[a-z][a-z0-9_]{1,30})$/));
