/** An Apple bundle at one version (catalog.ts Ver): its bytes from obj/<sha>, opened once per request, and what they say, cached under the sha. */

import { error } from "@sveltejs/kit";
import { sha1Hex, sha256Hex, sha384Hex } from "@carrier-explode/binary";
import type { OrderedCopy } from "@carrier-explode/db";
import {
	contentId,
	decodeFile,
	decodedPlist,
	decodedPri,
	isJsonDict,
	MemberError,
	openIpcc,
	type BundleInfo,
	type DecodedFile,
	type OpenedBundle,
	type PriDecoded,
} from "@carrier-explode/decode-ios";
import type { TimelineEntry } from "@carrier-explode/schema";
import { decoderFamily } from "@carrier-explode/schema/types";
import { keys } from "@carrier-explode/storage";
import type { PhoneFile } from "#lib/apple/phones.ts";
import type { Ver } from "#lib/types.ts";
import { cached, perRequest } from "../cache";
import { resolve, verFrom, type Resolved } from "../catalog";
import { readBytes } from "../store";
import { withPhones } from "./boards";

const otaFiles = (copies: readonly OrderedCopy[]) =>
	copies.flatMap((c) => (c.kind === "ota" ? [c.file] : []));

/** Where Apple serves a version: the file of its first OTA copy. */
export const upstream = (copies: readonly OrderedCopy[]): string | undefined => otaFiles(copies)[0]?.url;

async function bytesOf(e: TimelineEntry): Promise<Uint8Array<ArrayBuffer>> {
	const held = await readBytes(keys.obj(e.sha));
	if (!held) error(500, `obj/${e.sha} is indexed but missing from the bucket.`);
	return held;
}

export interface Digested {
	readonly sha256: string;
	readonly sha384: string;
	readonly sha1: string;
}

/** The stored bytes against the strongest digest Apple's manifest states for them; null when it states none (image copies). */
export function verify(copies: readonly OrderedCopy[], got: Digested): boolean | null {
	const stated = otaFiles(copies)[0]?.digests;
	if (stated?.sha384 !== undefined) return stated.sha384 === got.sha384;
	if (stated?.sha1 !== undefined) return stated.sha1 === got.sha1;
	return null;
}

export interface Opened extends Resolved {
	readonly opened: OpenedBundle;
	readonly bytes: Uint8Array<ArrayBuffer>;
	/** The bundle's files, each override file with the phones its boards are. */
	readonly files: readonly PhoneFile[];
}

async function resolveApple(v: Ver): Promise<Resolved> {
	const r = await resolve(v);
	if (decoderFamily(r.ref.platform) !== "apple") error(400, `${v.source} is not an Apple bundle.`);
	return r;
}

/** A version's bytes and zip index. Several queries of one page read the same bundle, so it is opened once per request. */
const openOnce = perRequest(async (source: string, line: string, slug: string): Promise<Opened> => {
	const r = await resolveApple(verFrom(source, line, slug));
	const bytes = await bytesOf(r.entry);
	const opened = openIpcc(bytes);
	return { ...r, opened, bytes, files: await withPhones(opened.info.files) };
});
export const open = (v: Ver): Promise<Opened> => openOnce(v.source, v.line ?? "", v.slug ?? "");

const QUICK = ["carrier.plist", "Info.plist", "version.plist"] as const;

/** What a bundle's bytes alone say. */
export interface BundleFacts {
	readonly info: BundleInfo;
	readonly size: number;
	readonly contentId: string;
	readonly digests: Digested;
	/** carrier.plist, Info.plist and version.plist, those it has: what the Overview and Settings read. */
	readonly quick: Readonly<Partial<Record<(typeof QUICK)[number], Readonly<Record<string, unknown>>>>>;
}

async function factsOf({ opened, bytes }: Opened): Promise<BundleFacts> {
	const [id, sha256, sha384] = await Promise.all([contentId(opened), sha256Hex(bytes), sha384Hex(bytes)]);
	return {
		info: opened.info,
		size: bytes.length,
		contentId: id,
		digests: { sha256, sha384, sha1: sha1Hex(bytes) },
		quick: Object.fromEntries(
			QUICK.flatMap((f) => {
				const p = plistOf(opened, f);
				return p ? [[f, p] as const] : [];
			}),
		),
	};
}

export interface Described extends Resolved {
	readonly facts: BundleFacts;
	/** The bundle's files, each override file with the phones its boards are. */
	readonly files: readonly PhoneFile[];
}

/** A version without its bytes: what they say is cached under its sha, which they never change under. */
const describeOnce = perRequest(async (source: string, line: string, slug: string): Promise<Described> => {
	const v = verFrom(source, line, slug);
	const r = await resolveApple(v);
	const facts = await cached(`ipcc-facts:v1:${r.entry.sha}`, async () => factsOf(await open(v)));
	return { ...r, facts, files: await withPhones(facts.info.files) };
});
export const describe = (v: Ver): Promise<Described> => describeOnce(v.source, v.line ?? "", v.slug ?? "");

/** A member, decoded and cached under its bundle's sha and its path. MemberError when the bundle has no such file. */
export async function decodedMember(v: Ver, path: string): Promise<DecodedFile> {
	const { entry } = await resolveApple(v);
	return cached(`ipcc-member:v1:${entry.sha}:${path}`, async () => decodeFile((await open(v)).opened, path));
}

/** A decoded .der.pri, or undefined when the bundle has no such file or it is not one: callers skip it, as the phone would. */
export function readPri(opened: OpenedBundle, path: string): PriDecoded | undefined {
	try {
		return decodedPri(decodeFile(opened, path));
	} catch (e) {
		if (e instanceof MemberError) return undefined;
		throw e;
	}
}

/** A member plist as a dictionary, or undefined when it is absent or not one (Files shows why). */
function plistOf(opened: OpenedBundle, path: string): Record<string, unknown> | undefined {
	if (!opened.info.files.some((f) => f.path === path)) return undefined;
	const v = decodedPlist(decodeFile(opened, path));
	return isJsonDict(v) ? v : undefined;
}
