/** Argument schemas the remote queries share. Every argument arrives from the client, so each is checked here. */

import * as v from "valibot";
import { VERSION_SLUG } from "#lib/schema/index.ts";
import { PLATFORMS } from "#lib/schema/types.ts";
import { KINDS } from "#lib/types.ts";

export const kind = v.picklist(KINDS);

/** A timeline slug of either platform: ios-27.0, ota-72.1, android-cp3a.260905.009-tokay. */
export const slug = v.pipe(v.string(), v.regex(VERSION_SLUG));

/** A page, at a version or at its head. */
export const bundle = { kind, name: v.pipe(v.string(), v.maxLength(200)), slug: v.exactOptional(slug) };

/** A page at a named version. */
export const pinned = { kind, name: v.pipe(v.string(), v.maxLength(200)), slug };

export const platform = v.picklist(PLATFORMS);

/** A release id: an iOS build (24A437) or an Android build id (CP3A.260905.009). */
export const release = v.pipe(v.string(), v.regex(/^[\w.]{3,40}$/));

/** An image build: 24A437. */
export const build = v.pipe(v.string(), v.regex(/^\w{3,16}$/));

/** A modem package, by the SHA-256 it is stored under. */
export const packageId = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));

/** A modem family: Mav25, C1. */
export const family = v.pipe(v.string(), v.regex(/^\w{1,16}$/));

/** A product type: iPhone18,1. */
export const device = v.pipe(v.string(), v.regex(/^[A-Za-z]+\d+,\d+$/));

export const index = v.pipe(v.number(), v.integer());

/** A path inside a bundle, or a key path inside a file. */
export const path = v.pipe(v.string(), v.maxLength(1024));

/** A phone a page can be read for: an iPhone product type (iPhone18,1) or a Pixel codename (tokay). */
export const phone = v.pipe(v.string(), v.regex(/^(?:[A-Za-z]+\d+,\d+|[a-z][a-z0-9_]{1,30})$/));
