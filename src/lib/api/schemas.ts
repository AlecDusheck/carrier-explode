/** Argument schemas the remote queries share. */

import * as v from "valibot";
import { KINDS } from "$lib/types";

export const kind = v.picklist(KINDS);

/** A bundle, at a version or at its head. */
export const bundle = { kind, name: v.string(), slug: v.optional(v.string()) };

/** A bundle at a named version. */
export const pinned = { kind, name: v.string(), slug: v.string() };

/** An image build: 24A437. */
export const build = v.pipe(v.string(), v.regex(/^\w{3,16}$/));

/** A modem package, by the SHA-256 it is stored under. */
export const packageId = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));

/** A modem family: Mav25, C1. */
export const family = v.pipe(v.string(), v.regex(/^\w{1,16}$/));

/** A product type: iPhone18,1. */
export const device = v.pipe(v.string(), v.regex(/^[A-Za-z]+\d+,\d+$/));

export const index = v.pipe(v.number(), v.integer());
