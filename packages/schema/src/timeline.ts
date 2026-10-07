/** Per-source histories from the copies the index holds: one entry per distinct content on a line, newest first. */

import { newestOf, type DeviceOrder } from "./devices.ts";
import {
	decoderFamily,
	MAIN_LINE,
	versionSlug,
	type EntryRef,
	type FirstSeen,
	type ReleaseHeader,
	type SourceRef,
} from "./types.ts";
import { compareDotted } from "@carrier-explode/values";

import { dottedKey } from "./versions.ts";

/** What orders a copy a release shipped. */
export interface ReleaseOrder {
	readonly id: string;
	/** YYYY-MM-DD. */
	readonly released: string | null;
	/** iOS only. */
	readonly prerelease: boolean | null;
	readonly sortKey: string;
}

/** A copy of a source's content on one line, from the release that shipped it or the OTA file that carries it. */
export type SourceCopy = {
	readonly line: string;
	readonly sha: string;
	/** Identical bytes reappear under new versions (an others.pb part takes others.pb's), so the copy states its own. */
	readonly version: string;
} & (
	| { readonly kind: "release"; readonly release: ReleaseOrder }
	| { readonly kind: "ota"; readonly file: { readonly published: string | null } }
);

/** One distinct content of a source on one line. */
export interface TimelineEntry extends EntryRef {
	readonly version: string;
	readonly sha: string;
	/** Only ever in betas. */
	readonly beta: boolean;
	/** Differs from the next older entry on its line. */
	readonly changed: boolean;
	/** YYYY-MM-DD the content first shipped; null when no release or file carrying it is dated. */
	readonly day: string | null;
}

/** Where a copy appeared: its day, and what names an older content under a reused version. */
interface Appearance {
	readonly day: string | null;
	readonly seen: FirstSeen | undefined;
}

function appearance(c: SourceCopy): Appearance {
	if (c.kind === "release") return { day: c.release.released, seen: { kind: "image", build: c.release.id } };
	const day = c.file.published;
	return { day, seen: day === null ? undefined : { kind: "ota", day } };
}

const seenKey = (s: FirstSeen | undefined): string =>
	s === undefined ? "" : s.kind === "ota" ? s.day : s.build;

/** Dated first, oldest first; then by what names it, so the choice never depends on input order. */
const byAppearance = (a: Appearance, b: Appearance): number =>
	(a.day === null ? 1 : 0) - (b.day === null ? 1 : 0) ||
	(a.day ?? "").localeCompare(b.day ?? "") ||
	seenKey(a.seen).localeCompare(seenKey(b.seen));

interface Content {
	readonly sha: string;
	readonly version: string;
	readonly firstSeen: FirstSeen | undefined;
	readonly firstDay: string | null;
	readonly lastDay: string | null;
	readonly beta: boolean;
}

function contentOf(copies: readonly [SourceCopy, ...SourceCopy[]]): Content {
	const [{ sha, version }] = copies;
	const seen = copies.map(appearance).toSorted(byAppearance);
	const dated = seen.flatMap((a) => a.day ?? []);
	return {
		sha,
		version,
		firstSeen: seen[0]?.seen,
		firstDay: dated[0] ?? null,
		lastDay: dated.at(-1) ?? null,
		beta: copies.every((c) => c.kind === "release" && c.release.prerelease === true),
	};
}

/** Newest first. A reused version names its older contents by first appearance; two it cannot tell apart fail the index. */
function lineEntries(line: string, copies: readonly SourceCopy[]): TimelineEntry[] {
	const contents = [...Map.groupBy(copies, (c) => `${c.sha}@${c.version}`).values()].flatMap(
		([first, ...rest]) => (first === undefined ? [] : [contentOf([first, ...rest])]),
	);
	const ordered = contents.toSorted(
		(a, b) =>
			compareDotted(b.version, a.version) ||
			(b.lastDay ?? "").localeCompare(a.lastDay ?? "") ||
			a.sha.localeCompare(b.sha),
	);
	const named = new Map<string, Content>();
	return ordered.map((c, i): TimelineEntry => {
		const slug = versionSlug(c.version, named.has(c.version) ? c.firstSeen : undefined);
		const clash = named.get(slug);
		if (clash !== undefined)
			throw new Error(`timeline: ${line || "main"} ${slug} names two contents: ${clash.sha} and ${c.sha}`);
		named.set(slug, c);
		return {
			line,
			slug,
			version: c.version,
			sha: c.sha,
			beta: c.beta,
			changed: ordered[i + 1]?.sha !== c.sha,
			day: c.firstDay,
		};
	});
}

/** A source's timeline from every copy of it: each line's entries, newest first, lines by name. */
export function sourceTimeline(copies: readonly SourceCopy[]): TimelineEntry[] {
	return [...Map.groupBy(copies, (c) => c.line)]
		.toSorted(([a], [b]) => a.localeCompare(b))
		.flatMap(([line, onLine]) => lineEntries(line, onLine));
}

/** Every line a source has, the default first: Apple's main line, then its models; Android's devices; each newest first. */
export function linesOf(source: SourceRef, timeline: readonly TimelineEntry[], order: DeviceOrder): string[] {
	const lines = [...new Set(timeline.map((e) => e.line))];
	if (decoderFamily(source.platform) !== "apple") return lines.toSorted(order);
	const models = lines.filter((l) => l !== MAIN_LINE).toSorted(order);
	return lines.includes(MAIN_LINE) ? [MAIN_LINE, ...models] : models;
}

/** One line's entries, newest first. */
export const lineOf = (timeline: readonly TimelineEntry[], line: string): TimelineEntry[] =>
	timeline.filter((e) => e.line === line);

/** The version a page shows when none is named: the newest release on the line, else its newest beta. Android defaults to its newest device. */
export function head(
	source: SourceRef,
	timeline: readonly TimelineEntry[],
	order: DeviceOrder,
	line?: string,
): TimelineEntry | undefined {
	const at = line ?? linesOf(source, timeline, order)[0];
	const entries = at === undefined ? [] : lineOf(timeline, at);
	return entries.find((e) => !e.beta) ?? entries[0];
}

/** The newest day any line's content changed: when the source was last updated. */
export const lastChanged = (timeline: readonly TimelineEntry[]): string | null =>
	timeline
		.flatMap((e) => (e.changed && e.day !== null ? [e.day] : []))
		.toSorted()
		.at(-1) ?? null;

/** Where the version holding `sha` is canonical: on Android, its newest device's line; an Apple version is canonical where it is. */
export function canonicalLine(
	source: SourceRef,
	timeline: readonly TimelineEntry[],
	sha: string,
	order: DeviceOrder,
): EntryRef | undefined {
	if (decoderFamily(source.platform) === "apple") return undefined;
	const holding = timeline.filter((e) => e.sha === sha);
	const line = newestOf(
		order,
		holding.map((e) => e.line),
	);
	const entry = holding.find((e) => e.line === line);
	return entry === undefined ? undefined : { line: entry.line, slug: entry.slug };
}

/** A version on a line, the one before it, and the line's head; or what the timeline lacks. */
export type VersionLookup =
	| {
			readonly found: true;
			readonly line: string;
			readonly entries: readonly TimelineEntry[];
			readonly entry: TimelineEntry;
			readonly previous: TimelineEntry | null;
			readonly latest: TimelineEntry;
	  }
	| { readonly found: false; readonly missing: "line" | "version" };

/** The version `slug` names on `line` (the source's default line when undefined), or the line's head without a slug. */
export function versionOn(
	source: SourceRef,
	timeline: readonly TimelineEntry[],
	order: DeviceOrder,
	line: string | undefined,
	slug: string | undefined,
): VersionLookup {
	const latest = head(source, timeline, order, line);
	if (latest === undefined) return { found: false, missing: "line" };
	const entries = lineOf(timeline, latest.line);
	const i = slug === undefined ? entries.indexOf(latest) : entries.findIndex((e) => e.slug === slug);
	const entry = entries[i];
	if (entry === undefined) return { found: false, missing: "version" };
	return { found: true, line: latest.line, entries, entry, previous: entries[i + 1] ?? null, latest };
}

/** What orders a release among its platform's by version. */
export interface ReleaseVersion {
	readonly id: string;
	readonly version: string;
	/** Pixel only: YYYY-MM. */
	readonly patch: string | null;
	readonly released: string | null;
}

/** Oldest first by version, then Pixel patch level, release day and id: the release a build's changes are against is the one before it. */
export const compareReleases = (a: ReleaseVersion, b: ReleaseVersion): number =>
	compareDotted(a.version, b.version) ||
	(a.patch ?? "").localeCompare(b.patch ?? "") ||
	(a.released ?? "").localeCompare(b.released ?? "") ||
	a.id.localeCompare(b.id);

/** Orders a platform's releases oldest to newest as text: by release day, an undated one oldest; then version by segment, Pixel patch level and id. */
export const releaseSortKey = (r: ReleaseHeader): string =>
	[r.released ?? "", dottedKey(r.version), r.platform === "android" ? r.patch : "", r.id].join(" ");
