/** The site's only door to R2. The site only reads, and validates every JSON record on the way in. */

import { env } from "cloudflare:workers";
import * as v from "valibot";
import { readModemRecord, readRecord } from "@carrier-explode/storage";

/** A JSON record, validated (a broken one throws, a 500); null when the key is absent. */
export const readJson = <T>(key: string, schema: v.GenericSchema<unknown, T>): Promise<T | null> =>
	readRecord(env.BUCKET, key, schema);

/** A modem record (keys.modemConfig, keys.combos), as readJson, at the previous modem schema while the current is unwritten. */
export const readModemJson = <T>(key: string, schema: v.GenericSchema<unknown, T>): Promise<T | null> =>
	readModemRecord(env.BUCKET, key, schema);

/** An object's bytes, or one range of them; null when the key is absent. */
export async function readBytes(
	key: string,
	range?: { offset: number; length: number },
): Promise<Uint8Array<ArrayBuffer> | null> {
	const obj = await env.BUCKET.get(key, range ? { range } : undefined);
	return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}

/** An object's metadata; null when the key is absent. */
export const headObject = (key: string): Promise<R2Object | null> => env.BUCKET.head(key);

/** An object, without its body when the request's validators match it; null when the key is absent. */
export const getObject = (key: string, request: Request): Promise<R2ObjectBody | R2Object | null> =>
	env.BUCKET.get(key, { onlyIf: request.headers });
