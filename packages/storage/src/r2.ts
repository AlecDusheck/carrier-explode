/** The bucket's writes and the reindex listing, through the R2 Workers binding. */

import * as v from "valibot";

import { keys } from "./keys.ts";

const CONTENT_TYPES = ["application/json", "application/zip", "application/octet-stream"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** obj/ `customMetadata.kind`. */
export const ARTIFACT_KINDS = [
	"apple.ipcc",
	"apple.bbfw",
	"apple.ftab",
	"android.carrier-settings",
	"android.carrier-list",
	"android.modem-config",
	"samsung.omc",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

const ARTIFACT_CONTENT_TYPE = {
	"apple.ipcc": "application/zip",
	"apple.bbfw": "application/zip",
	"apple.ftab": "application/octet-stream",
	"android.carrier-settings": "application/octet-stream",
	"android.carrier-list": "application/octet-stream",
	"android.modem-config": "application/zip",
	/** One sales code's conf/ directory and its IMS operator (decode-samsung packOmc). */
	"samsung.omc": "application/zip",
} as const satisfies Record<ArtifactKind, ContentType>;

export type R2Body = Parameters<R2Bucket["put"]>[1];

/** Fails when the key exists, so a concurrent writer of the same content never overwrites. */
const writeOnce = (): Headers => new Headers({ "If-None-Match": "*" });

/** Writes `key` unless it exists; null when it did, and nothing was written. */
export function putOnce(
	bucket: R2Bucket,
	key: string,
	body: R2Body,
	contentType: ContentType,
): Promise<R2Object | null> {
	return bucket.put(key, body, { onlyIf: writeOnce(), httpMetadata: { contentType } });
}

/** Stores an artifact under its own sha256, which R2 checks the bytes against; null when it was already held. */
export function putObj(
	bucket: R2Bucket,
	sha256: string,
	body: R2Body,
	kind: ArtifactKind,
): Promise<R2Object | null> {
	return bucket.put(keys.obj(sha256), body, {
		onlyIf: writeOnce(),
		sha256,
		httpMetadata: { contentType: ARTIFACT_CONTENT_TYPE[kind] },
		customMetadata: { kind },
	});
}

/** For norm/ and decoded/, which are content-keyed. */
export function putJsonOnce(bucket: R2Bucket, key: string, value: unknown): Promise<R2Object | null> {
	return putOnce(bucket, key, JSON.stringify(value), "application/json");
}

/** For releases/ and ota/ records, which a rerun of their unit replaces; `customMetadata` shows in listings. */
export function putJson(
	bucket: R2Bucket,
	key: string,
	value: unknown,
	customMetadata: Record<string, string> = {},
): Promise<R2Object> {
	return bucket.put(key, JSON.stringify(value), {
		httpMetadata: { contentType: "application/json" },
		customMetadata,
	});
}

export interface HeldArtifact {
	readonly sha256: string;
	readonly kind: ArtifactKind;
}

/** Every obj/ artifact with its kind, from the listing alone. */
export async function* heldArtifacts(bucket: R2Bucket): AsyncGenerator<HeldArtifact> {
	let cursor: string | undefined;
	do {
		const page = await bucket.list({
			prefix: keys.objPrefix(),
			include: ["customMetadata"],
			...(cursor === undefined ? {} : { cursor }),
		});
		for (const o of page.objects) {
			const sha256 = keys.shaOfObj(o.key);
			if (sha256 === undefined) throw new Error(`${o.key}: not an obj/ key`);
			yield { sha256, kind: v.parse(v.picklist(ARTIFACT_KINDS), o.customMetadata?.kind) };
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor !== undefined);
}
