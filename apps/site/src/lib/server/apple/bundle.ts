/** iOS native views of an Apple bundle at one version: the bundle, its files decoded one by one, its alerts, and the file-by-file comparison. */

import { error } from "@sveltejs/kit";
import {
	compareBundles,
	contentId,
	decodeFile,
	deviceStem,
	type BundleDiff,
	type BundleInfo,
	MemberError,
	type DecodedFile,
} from "@carrier-explode/decode-ios";
import { errorMessage, sha1Hex, sha256Hex, sha384Hex } from "@carrier-explode/binary";
import { countryName, iosModemConfig, type TimelineEntry } from "@carrier-explode/schema";
import {
	sourceKey,
	type ModemConfig,
	type Platform,
	type SourceKey,
	type SourceRef,
} from "@carrier-explode/schema/types";
import type { PhoneFile, WithPhones } from "#lib/apple/phones.ts";
import type { Ver, Version } from "#lib/types.ts";
import { cached } from "../cache";
import {
	copiesOfEntry,
	copiesOfSource,
	countryOf,
	isIndexed,
	resolve,
	verAt,
	versionOf,
	type Resolved,
} from "../catalog";
import type { Side } from "../compare";
import { cbsRow, type CbsRow } from "./cbs";
import { withPhones } from "./boards";
import { open, plistOf, upstream, verify, type Digested } from "./bytes";

/** A carrier bundle's home country bundle, by HomeBundleIdentifier ("com.apple.UnitedStates"), when the index has it. */
async function homeCountry(
	platform: Platform,
	carrier: Record<string, unknown> | undefined,
): Promise<SourceKey | null> {
	const home = carrier?.HomeBundleIdentifier;
	if (typeof home !== "string") return null;
	const name = home.replace(/^com\.apple\./, "");
	const key = sourceKey({ platform, kind: "country", name });
	return (await isIndexed(key)) ? key : null;
}

export interface IosBundle {
	readonly source: string;
	readonly ref: SourceRef;
	readonly cc: string | undefined;
	readonly countryName: string | undefined;
	readonly line: string;
	readonly entry: Version;
	readonly previous: Version | null;
	readonly info: Omit<BundleInfo, "files"> & { readonly files: readonly PhoneFile[] };
	readonly downloadSize: number;
	readonly contentId: string;
	readonly digests: Digested;
	/** Where Apple serves it, when an OTA copy exists. */
	readonly download: string | undefined;
	/** Whether the bytes are what the index or Apple says they are; null when nothing says. */
	readonly verified: boolean | null;
	/** carrier.plist, Info.plist and version.plist, decoded: what the Overview and Settings read. */
	readonly quick: Readonly<Record<string, unknown>>;
	/** The home country bundle's source key, for a carrier bundle that names one. */
	readonly home: SourceKey | null;
}

export async function getBundle(v: Ver): Promise<IosBundle> {
	const o = await open(v);
	const { entry, opened, bytes, files } = o;
	const [id, sha256, sha384, current, previous, held, cc] = await Promise.all([
		contentId(opened),
		sha256Hex(bytes),
		sha384Hex(bytes),
		versionOf(o, entry),
		o.previous ? versionOf(o, o.previous) : null,
		copiesOfSource(o.key, o.ref.platform),
		countryOf(o.key),
	]);
	const digests = { sha256, sha384, sha1: sha1Hex(bytes) };
	const quick: Record<string, unknown> = {};
	for (const f of ["carrier.plist", "Info.plist", "version.plist"]) {
		const p = plistOf(opened, f);
		if (p) quick[f] = p;
	}
	const copies = copiesOfEntry(held, entry);

	return {
		source: o.key,
		ref: o.ref,
		cc: cc ?? undefined,
		countryName: cc === null ? undefined : countryName(cc),
		line: o.line,
		entry: current,
		previous,
		info: { ...opened.info, files },
		downloadSize: bytes.length,
		contentId: id,
		digests,
		download: upstream(copies),
		verified: verify(copies, digests),
		quick,
		home:
			o.ref.kind === "carrier" ? await homeCountry(o.ref.platform, plistOf(opened, "carrier.plist")) : null,
	};
}

export async function getFile(v: Ver, path: string): Promise<WithPhones<DecodedFile>> {
	const { opened } = await open(v);
	const decoded = (): DecodedFile => {
		try {
			return decodeFile(opened, path);
		} catch (e) {
			if (e instanceof MemberError) error(404, e.message);
			throw e;
		}
	};
	const [file] = await withPhones([decoded()]);
	if (file === undefined) error(500, `${path}: decoded to nothing`);
	return file;
}

/** A modem override file as the neutral modem model has it; null for an Intel / Apple C1 file. */
export async function getModemConfig(v: Ver, path: string): Promise<ModemConfig | null> {
	const { opened, entry } = await open(v);
	try {
		return iosModemConfig(opened, path, entry.sha);
	} catch (e) {
		error(404, errorMessage(e));
	}
}

export async function getRaw(v: Ver, path: string): Promise<Uint8Array> {
	const { opened } = await open(v);
	const bytes = opened.entries[opened.prefix + path];
	if (!bytes) error(404, `no such file: ${path}`);
	return bytes;
}

/** A country bundle's emergency alert settings at this version. */
export async function getAlerts(v: Ver): Promise<CbsRow | null> {
	const { opened } = await open(v);
	const plist = plistOf(opened, "carrier.plist");
	const locales = opened.info.files
		.filter((f) => f.path.endsWith("CBMessage.strings"))
		.flatMap((f) => f.locale ?? []);
	return plist ? cbsRow(plist, locales) : null;
}

interface ComparedSide {
	readonly source: SourceKey;
	readonly ref: SourceRef;
	readonly line: string;
	readonly entry: Version;
}

export interface NativeComparison {
	readonly a: ComparedSide | null;
	readonly b: ComparedSide;
	readonly diff: BundleDiff | null;
}

/** A side's phone, by the boards its variant (an override file) names. */
const phoneOf = (s: Side | null): string | null =>
	s?.variant === undefined ? null : (deviceStem(s.variant) ?? null);

const comparedSide = async (r: Resolved, entry: TimelineEntry): Promise<ComparedSide> => ({
	source: r.key,
	ref: r.ref,
	line: r.line,
	entry: await versionOf(r, entry),
});

/**
 * `b` against `a` file by file, or against the version before it without `a`. A side seen by a phone compares
 * that phone's override files with the other's.
 */
export async function getComparison(a: Side | null, b: Side, path?: string): Promise<NativeComparison> {
	const phones =
		a?.variant !== undefined || b.variant !== undefined ? { a: phoneOf(a), b: phoneOf(b) } : undefined;
	const [rb, ra] = await Promise.all([resolve(b), a ? resolve(a) : null]);
	const left = ra ? { r: ra, entry: ra.entry } : rb.previous ? { r: rb, entry: rb.previous } : null;
	const right = await comparedSide(rb, rb.entry);
	if (!left) return { a: null, b: right, diff: null };
	const leftSide = await comparedSide(left.r, left.entry);
	const diff = await cached(
		`compare:v3:${left.entry.sha}|${rb.entry.sha}|${path ?? ""}|${phones ? `${phones.a}|${phones.b}` : ""}`,
		async () => {
			const [A, B] = await Promise.all([
				open(verAt(leftSide.source, { line: left.r.line, slug: left.entry.slug })),
				open(verAt(right.source, { line: rb.line, slug: rb.entry.slug })),
			]);
			return compareBundles(A.opened, B.opened, {
				...(path ? { path } : {}),
				...(phones ? { phones } : {}),
				maxRows: path ? 2000 : 400,
			});
		},
	);
	return { a: leftSide, b: right, diff };
}
