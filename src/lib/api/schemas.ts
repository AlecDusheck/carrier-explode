/** Argument schemas the remote queries share. Every argument arrives from the client, so each is checked here. */

import * as v from "valibot";
import { parseSourceKey, PLATFORMS } from "#lib/schema/types.ts";

/** A source key: `ios:carrier:ATT_US`, `android:carrier:tmobile_us`. */
export const source = v.pipe(v.string(), v.check((s) => parseSourceKey(s) !== null, "not a source key"));

/** A timeline slug: ios-27.0, ota-72.1, android-cp3a.260905.009. */
export const slug = v.pipe(v.string(), v.regex(/^(ota|ios|android)-[\w.,-]+$/));

/** A source at a version, or at its head. */
export const at = { source, slug: v.exactOptional(slug) };

/** A source at a named version. */
export const pinned = { source, slug };

export const platform = v.picklist(PLATFORMS);

/** A carrier slug: t-mobile-us. */
export const carrier = v.pipe(v.string(), v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/));

/** An ISO 3166 alpha-2 country code, lower case. */
export const iso = v.pipe(v.string(), v.regex(/^[a-z]{2}$/));

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
