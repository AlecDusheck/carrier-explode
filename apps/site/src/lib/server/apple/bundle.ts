/** iOS native views of an Apple bundle at one version: the bundle, its files decoded one by one, its alerts, and the file-by-file comparison. */

import { error } from "@sveltejs/kit";
import {
	compareBundles,
	deviceStem,
	type BundleDiff,
	type BundleInfo,
	MemberError,
	type DecodedFile,
} from "@carrier-explode/decode-ios";
import { errorMessage } from "@carrier-explode/binary";
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
import { copiesOfEntry, countryOf, isIndexed, resolve, verAt, versionOf, type Resolved } from "../catalog";
import type { Side } from "../compare";
import { cbsRow, type CbsRow } from "./cbs";
import { withPhones } from "./boards";
import { decodedMember, describe, open, upstream, verify, type BundleFacts, type Digested } from "./bytes";

/** A carrier bundle's home country bundle, by HomeBundleIdentifier ("com.apple.UnitedStates"), when the index has it. */
async function homeCountry(
	platform: Platform,
	carrier: Readonly<Record<string, unknown>> | undefined,
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
	readonly quick: BundleFacts["quick"];
	/** The home country bundle's source key, for a carrier bundle that names one. */
	readonly home: SourceKey | null;
}

export async function getBundle(v: Ver): Promise<IosBundle> {
	const d = await describe(v);
	const { entry, facts } = d;
	const [current, previous, cc, home] = await Promise.all([
		versionOf(d, entry),
		d.previous ? versionOf(d, d.previous) : null,
		countryOf(d.key),
		d.ref.kind === "carrier" ? homeCountry(d.ref.platform, facts.quick["carrier.plist"]) : null,
	]);
	const copies = copiesOfEntry(d.copies, entry);
	return {
		source: d.key,
		ref: d.ref,
		cc: cc ?? undefined,
		countryName: cc === null ? undefined : countryName(cc),
		line: d.line,
		entry: current,
		previous,
		info: { ...facts.info, files: d.files },
		downloadSize: facts.size,
		contentId: facts.contentId,
		digests: facts.digests,
		download: upstream(copies),
		verified: verify(copies, facts.digests),
		quick: facts.quick,
		home,
	};
}

export async function getFile(v: Ver, path: string): Promise<WithPhones<DecodedFile>> {
	const decoded = await decodedMember(v, path).catch((e: unknown) => {
		if (e instanceof MemberError) error(404, e.message);
		throw e;
	});
	const [file] = await withPhones([decoded]);
	if (file === undefined) error(500, `${path}: decoded to nothing`);
	return file;
}

/** A modem override file as the neutral modem model has it; null for an Intel-dialect file. */
export async function getModemConfig(v: Ver, path: string): Promise<ModemConfig | null> {
	const { entry } = await resolve(v);
	// Wrapped, as the cache keeps no null.
	const read = await cached(`ipcc-modem:v2:${entry.sha}:${path}`, async () => {
		const { opened } = await open(v);
		try {
			return { config: iosModemConfig(opened, path, entry.sha) };
		} catch (e) {
			error(404, errorMessage(e));
		}
	});
	return read.config;
}

export async function getRaw(v: Ver, path: string): Promise<Uint8Array> {
	const { opened } = await open(v);
	const bytes = opened.entries[opened.prefix + path];
	if (!bytes) error(404, `no such file: ${path}`);
	return bytes;
}

/** A country bundle's emergency alert settings at this version. */
export async function getAlerts(v: Ver): Promise<CbsRow | null> {
	const { facts } = await describe(v);
	const plist = facts.quick["carrier.plist"];
	const locales = facts.info.files
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
