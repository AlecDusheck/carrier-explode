/** The bucket as container jobs reach it (container-protocol.ts), served with the R2 binding: no S3 credentials, and the same against a local bucket. */

import * as v from "valibot";

import { ARTIFACT_KINDS, keys, putObj } from "@carrier-explode/storage";
import { KIND_HEADER } from "./container-protocol.ts";

const once = (): Headers => new Headers({ "If-None-Match": "*" });

const written = (o: R2Object | null): Response => new Response(null, { status: o === null ? 412 : 201 });

async function put(req: Request, bucket: R2Bucket, key: string): Promise<Response> {
	const body = req.body;
	if (body === null) return new Response(`${key}: no body`, { status: 400 });
	const sha = keys.shaOfObj(key);
	if (sha !== undefined)
		return written(
			await putObj(bucket, sha, body, v.parse(v.picklist(ARTIFACT_KINDS), req.headers.get(KIND_HEADER))),
		);
	const contentType = req.headers.get("content-type");
	if (contentType === null) return new Response(`${key}: no content-type`, { status: 400 });
	return written(
		await bucket.put(key, body, {
			httpMetadata: { contentType },
			...(req.headers.get("if-none-match") === "*" ? { onlyIf: once() } : {}),
		}),
	);
}

export async function serveBucket(req: Request, bucket: R2Bucket): Promise<Response> {
	const key = decodeURIComponent(new URL(req.url).pathname.slice(1));
	switch (req.method) {
		case "GET": {
			const o = await bucket.get(key);
			return o === null
				? new Response(`${key}: missing`, { status: 404 })
				: new Response(o.body, { headers: { "content-length": String(o.size) } });
		}
		case "PUT":
			return put(req, bucket, key);
		default:
			return new Response(`${req.method}: not served`, { status: 405 });
	}
}
