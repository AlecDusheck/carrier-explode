/** The bucket over the Extractor object (src/container-protocol.ts): plain HTTP, files streamed from disk. */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Agent, request, type IncomingMessage } from "node:http";
import { pipeline } from "node:stream/promises";

import { HttpError } from "@carrier-explode/http";
import { keys, type ArtifactKind, type ContentType } from "@carrier-explode/storage";
import { BUCKET_HOST, KIND_HEADER } from "../../src/container-protocol.ts";

type Body = Uint8Array | string | { readonly file: string };

export interface Bucket {
	/** null when the key is missing. */
	get(key: string): Promise<Uint8Array | null>;
	/** Writes `key` unless it exists; false when it did. */
	putOnce(key: string, body: Body, contentType: ContentType): Promise<boolean>;
	/** Stores an artifact under its sha256, which R2 checks the bytes against; false when it was held. */
	putObj(sha256: string, body: Body, kind: ArtifactKind): Promise<boolean>;
}

async function read(res: IncomingMessage): Promise<Uint8Array> {
	const chunks: Buffer[] = [];
	for await (const chunk of res) if (Buffer.isBuffer(chunk)) chunks.push(chunk);
	return new Uint8Array(Buffer.concat(chunks));
}

/** A connection per request: the proxy closes idle ones, and a reused one it closed fails the request ("socket hang up"). */
const agent = new Agent({ keepAlive: false });

async function call(
	origin: Origin,
	method: "GET" | "PUT",
	key: string,
	headers: Record<string, string>,
	body?: Body,
): Promise<{ status: number; bytes: Uint8Array }> {
	const length =
		body === undefined
			? 0
			: typeof body === "string"
				? Buffer.byteLength(body)
				: body instanceof Uint8Array
					? body.length
					: (await stat(body.file)).size;
	return new Promise((resolve, reject) => {
		const req = request(
			{
				...origin,
				agent,
				method,
				path: `/${encodeURI(key)}`,
				headers: { ...headers, "content-length": String(length) },
			},
			(res) => {
				read(res).then((bytes) => resolve({ status: res.statusCode ?? 0, bytes }), reject);
			},
		);
		req.on("error", reject);
		if (body === undefined || typeof body === "string" || body instanceof Uint8Array) req.end(body);
		else pipeline(createReadStream(body.file), req).catch(reject);
	});
}

/** The proxy's refusal, with its status, so permanent() tells a refused request from a failing bucket. */
class BucketError extends HttpError {
	override name = "BucketError";
	constructor(method: string, key: string, status: number, bytes: Uint8Array) {
		super(`${method} ${key}`, status);
		this.message = `${method} ${key}: ${status} ${new TextDecoder().decode(bytes)}`;
	}
}

export interface Origin {
	readonly host: string;
	readonly port: number;
}

export function bucketAt(origin: Origin): Bucket {
	/** 201 written, 412 held. */
	const putting = async (key: string, headers: Record<string, string>, body: Body): Promise<boolean> => {
		const { status, bytes } = await call(origin, "PUT", key, headers, body);
		if (status === 201 || status === 412) return status === 201;
		throw new BucketError("PUT", key, status, bytes);
	};
	return {
		async get(key) {
			const { status, bytes } = await call(origin, "GET", key, {});
			if (status === 404) return null;
			if (status !== 200) throw new BucketError("GET", key, status, bytes);
			return bytes;
		},
		putOnce: (key, body, contentType) =>
			putting(key, { "content-type": contentType, "if-none-match": "*" }, body),
		putObj: (sha256, body, kind) => putting(keys.obj(sha256), { [KIND_HEADER]: kind }, body),
	};
}

export const bucket: Bucket = bucketAt({ host: BUCKET_HOST, port: 80 });
