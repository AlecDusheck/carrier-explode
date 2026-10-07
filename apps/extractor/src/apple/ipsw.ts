/**
 * The ios.ipsw container job's contract (what the Worker asks of one IPSW, and what the container answers), and image
 * bundles as artifacts: a deterministic .ipcc with the decoder's content id, and one build's copies merged across its IPSWs.
 */

import * as v from "valibot";

import { compareUtf8, sha256Hex } from "@carrier-explode/binary";
import {
	bundleVersion,
	contentId,
	openIpcc,
	packIpcc,
	type UnpackedBundle,
	type UnpackedFile,
} from "@carrier-explode/decode-ios";
import { imageModemSchema, sha256Schema } from "@carrier-explode/schema/records";
import { parseSourceKey, type AppleArtifact, type SourceKey } from "@carrier-explode/schema/types";
import type { ContainerJob } from "../container-protocol.ts";
import type { UnitContext } from "../unit.ts";
import type { IosBuild } from "./plan.ts";

const str = v.pipe(v.string(), v.minLength(1));

export const ipswParamsSchema = v.object({
	build: str,
	device: str,
	url: v.pipe(v.string(), v.url()),
	/** Names the tmp/<instance>/ its bundle copies go to. */
	instance: str,
});
export type IpswParams = v.InferOutput<typeof ipswParamsSchema>;

const imageBundleKey = v.custom<SourceKey<"ios">>((s) => {
	const ref = typeof s === "string" ? parseSourceKey(s) : undefined;
	return ref?.platform === "ios" && ref.kind !== "default";
}, "expected an iOS carrier or country bundle's sourceKey");

export const ipswOutputSchema = v.object({
	/** The phones the IPSW installs. */
	devices: v.array(str),
	/** Each bundle copy, stored at keys.tmp(instance, sha). */
	bundles: v.array(
		v.object({
			source: imageBundleKey,
			sha: sha256Schema,
			version: v.string(),
			size: v.number(),
			cid: v.string(),
		}),
	),
	modems: v.array(imageModemSchema),
});
export type IpswOutput = v.InferOutput<typeof ipswOutputSchema>;

/** The job for one IPSW: its bundle copies to tmp/<instance>/, its modem packages to obj/ and their summaries to decoded/. */
export const ipswJob = (build: IosBuild, ipsw: IosBuild["ipsws"][number], u: UnitContext): ContainerJob => ({
	job: "ios.ipsw",
	params: {
		build: build.build,
		device: ipsw.device,
		url: ipsw.url,
		instance: u.instance,
	} satisfies IpswParams,
});

export interface PackedBundle {
	readonly bytes: Uint8Array;
	readonly artifact: AppleArtifact;
}

export async function packBundle(b: UnpackedBundle): Promise<PackedBundle> {
	const version = bundleVersion(b);
	if (version === undefined) throw new Error(`${b.name}.bundle: no CFBundleVersion in Info.plist`);
	const bytes = packIpcc(b);
	const [sha, cid] = await Promise.all([sha256Hex(bytes), contentId(openIpcc(bytes))]);
	return { bytes, artifact: { sha, version, size: bytes.length, cid } };
}

/** `overrides_D93_D94.plist`, `.der.pri`, and their `signatures/` entries: each IPSW carries only its own phones'. */
const isOverride = (path: string): boolean => /(^|\/)overrides_[^/]+$/.test(path);

interface Seen {
	readonly file: UnpackedFile;
	readonly sha: string;
}

/**
 * A build's bundle is the union of its IPSWs' copies, each read only when the one before it is merged: a build's
 * Default.bundle is ~13 MB a copy, one per IPSW. Fails on any difference but an override file some copies lack.
 */
export async function mergeCopies(
	copies: ReadonlyArray<() => Promise<UnpackedBundle>>,
): Promise<UnpackedBundle> {
	const seen = new Map<string, Seen>();
	let name: string | undefined;
	for (const [i, read] of copies.entries()) {
		const c = await read();
		name ??= c.name;
		if (c.name !== name) throw new Error(`merging ${c.name}.bundle into ${name}.bundle`);
		const where = (path: string): string => `${name}.bundle/${path}`;
		const missing = (path: string, sha: string, at: number): Error =>
			new Error(`${where(path)} (sha256 ${sha}) is missing from IPSW ${at + 1} of ${copies.length}`);
		const here = new Set<string>();
		for (const file of c.files) {
			here.add(file.path);
			const sha = await sha256Hex(file.bytes);
			const have = seen.get(file.path);
			if (have === undefined) {
				if (i > 0 && !isOverride(file.path)) throw missing(file.path, sha, 0);
				seen.set(file.path, { file, sha });
			} else if (have.sha !== sha)
				throw new Error(`${where(file.path)} differs between IPSWs: sha256 ${have.sha} vs ${sha}`);
		}
		for (const [path, { sha }] of seen) if (!isOverride(path) && !here.has(path)) throw missing(path, sha, i);
	}
	if (name === undefined) throw new Error("no copies to merge");
	return {
		name,
		files: [...seen.values()].map((s) => s.file).toSorted((a, b) => compareUtf8(a.path, b.path)),
	};
}
