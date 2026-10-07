/** The daily dataset archive the extractor writes: its file, and what its metadata says of it. */

import * as v from "valibot";
import { datasetMetadataSchema, keys, type DatasetMetadata } from "@carrier-explode/storage";
import { getObject, headObject } from "./store.ts";

/** Its date, digest and size; null before the first is built. */
export async function datasetFacts(): Promise<DatasetMetadata | null> {
	const held = await headObject(keys.dataset());
	return held === null ? null : v.parse(datasetMetadataSchema, held.customMetadata);
}

/** The archive, streamed; a 304 when the request's validators match it. */
export async function datasetResponse(request: Request): Promise<Response> {
	const object = await getObject(keys.dataset(), request);
	if (object === null) return new Response("Not found\n", { status: 404 });
	const headers = new Headers({
		"content-type": "application/zip",
		"content-disposition": 'attachment; filename="carrier-explode.zip"',
		etag: object.httpEtag,
	});
	if (!("body" in object)) return new Response(null, { status: 304, headers });
	headers.set("content-length", String(object.size));
	return new Response(object.body, { headers });
}
