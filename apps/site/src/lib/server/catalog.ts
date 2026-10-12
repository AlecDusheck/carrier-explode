/** The index in D1 as pages read it: a source, its timeline as schema ordered it, its copies, and the devices and releases that name them. */

import { error, redirect } from "@sveltejs/kit";
import {
	carrierMembers as membersOf,
	copiesOf,
	deviceList,
	entriesOf,
	modemsOf,
	releaseList,
	sourceOf,
	type ListedRelease,
	type ModemRow,
	type OrderedCopy,
	type Page,
	type ShownDevice,
} from "@carrier-explode/db";
import {
	canonicalLine,
	newestFirst,
	versionOn,
	type DeviceOrder,
	type TimelineEntry,
	type VersionLookup,
} from "@carrier-explode/schema";
import {
	linePlatform,
	MAIN_LINE,
	sourceOf as refOf,
	sourcePath,
	versionPath,
	type EntryRef,
	type Platform,
	type ReleasePlatform,
	type SourceKey,
	type SourceRef,
} from "@carrier-explode/schema/types";
import { keys } from "@carrier-explode/storage";
import { trainVersions } from "#lib/android/naming.ts";
import { NAMING } from "#lib/naming.ts";
import { PLATFORM_NAMES } from "#lib/platforms.ts";
import type { Ver, Version, VersionCopy } from "#lib/types.ts";
import { cached, perRequest } from "./cache";
import { db, everyPage, indexVersion } from "./db";
import { readBytes } from "./store";

/** The OS images whose devices are a platform's phones: iPads and watches ship in none. */
export const PHONE_IMAGES = {
	ios: "ios",
	ipados: null,
	watchos: null,
	android: "android",
	samsung: "samsung",
} as const satisfies Record<Platform, ReleasePlatform | null>;

/** A platform's phones, newest first. */
export const devicesOf = perRequest(async (platform: ReleasePlatform): Promise<ShownDevice[]> =>
	cached(`devices:v1:${platform}:${await indexVersion()}`, async () => deviceList(await db(), platform)),
);

/** Each device's name, by code. */
export const deviceNames = perRequest(
	async (platform: ReleasePlatform): Promise<ReadonlyMap<string, string>> =>
		new Map((await devicesOf(platform)).map((d) => [d.code, d.name])),
);

/** The order a platform's lines are listed in: its devices, newest first. */
export const deviceOrder = async (platform: Platform): Promise<DeviceOrder> =>
	newestFirst(await devicesOf(linePlatform(platform)));

/** A platform's releases, newest first. */
export const releasesOf = perRequest(async (platform: ReleasePlatform): Promise<ListedRelease[]> =>
	cached(`releases:v1:${platform}:${await indexVersion()}`, async () => {
		const d = await db();
		return everyPage(
			(page: Page<string>) => releaseList(d, platform, page),
			(r) => r.sortKey,
		);
	}),
);

/** A release's modems as the index has them, each family named. */
export type ShippedModem = ModemRow & { readonly familyName: string };

export const shippedModems = perRequest(
	async (platform: ReleasePlatform, build: string): Promise<ShippedModem[]> =>
		modemsOf(await db(), platform, build),
);

type SourceHeader = NonNullable<Awaited<ReturnType<typeof sourceOf>>>;

/** A source as its header shows it; undefined when the index lacks it. */
export const sourceRow = perRequest(async (key: SourceKey): Promise<SourceHeader | undefined> =>
	sourceOf(await db(), key),
);

export const isIndexed = async (key: SourceKey): Promise<boolean> => (await sourceRow(key)) !== undefined;

/** Every source of a source's carrier, each platform's primary first; none until linked, and for a country bundle. */
export const carrierMembers = async (key: SourceKey): Promise<readonly SourceKey[]> => {
	const carrier = (await sourceRow(key))?.carrier ?? null;
	return carrier === null ? [] : membersOf(await db(), carrier);
};

/** A source's country: its carrier's, or a country bundle's own. */
export const countryOf = async (key: SourceKey): Promise<string | null> => (await sourceRow(key))?.cc ?? null;

/** A source, its timeline, and the order its lines are listed in. */
export interface Located {
	readonly key: SourceKey;
	readonly ref: SourceRef;
	readonly source: SourceHeader;
	readonly timeline: readonly TimelineEntry[];
	readonly order: DeviceOrder;
	/** Every copy of it: what names its versions, and a version page's "Shipped in". */
	readonly copies: readonly OrderedCopy[];
}

export const locate = perRequest(async (key: SourceKey): Promise<Located> => {
	const ref = refOf(key);
	const [source, timeline, order, copies] = await Promise.all([
		sourceRow(key),
		db().then((d) => entriesOf(d, key)),
		deviceOrder(ref.platform),
		db().then((d) => copiesOf(d, key, ref.platform)),
	]);
	if (!source) error(404, `No ${ref.name} on ${ref.platform}.`);
	return { key, ref, source, timeline, order, copies };
});

export const verKey = (v: Ver): string => `${v.source}\0${v.line ?? ""}\0${v.slug ?? ""}`;

/** A resolved version as query args again: Apple's main line has no line segment. */
export const verAt = (source: SourceKey, at: EntryRef): Ver =>
	at.line === MAIN_LINE ? { source, slug: at.slug } : { source, line: at.line, slug: at.slug };

export interface Resolved extends Located {
	readonly line: string;
	readonly entries: readonly TimelineEntry[];
	readonly entry: TimelineEntry;
	readonly previous: TimelineEntry | null;
	/** The version shown when none is named: the line's newest release, else its newest beta. */
	readonly latest: TimelineEntry;
}

type Missing = (
	located: Located,
	missing: Extract<VersionLookup, { readonly found: false }>["missing"],
) => never;

const notFound =
	(v: Ver): Missing =>
	(located, missing) =>
		error(404, `${located.ref.name} has no ${missing} ${(missing === "line" ? v.line : v.slug) ?? ""}.`);

async function resolveOr(v: Ver, missing: Missing): Promise<Resolved> {
	const located = await locate(v.source);
	const at = versionOn(located.ref, located.timeline, located.order, v.line, v.slug);
	if (!at.found) missing(located, at.missing);
	const { line, entries, entry, previous, latest } = at;
	return { ...located, line, entries, entry, previous, latest };
}

export const resolve = (v: Ver): Promise<Resolved> => resolveOr(v, notFound(v));

/** A page's version: one the index lacks is a stale link, so its source's page stands in, as legacy.ts answers a full load. */
export const resolvePage = (v: Ver): Promise<Resolved> =>
	resolveOr(v, (located) => redirect(302, sourcePath(located.ref)));

/** Several Pixels often carry one file; the newest one's line is where its page is canonical. */
export const canonicalPath = (r: Resolved): string =>
	versionPath(
		r.ref,
		canonicalLine(r.ref, r.timeline, r.entry.sha, r.order) ?? { line: r.line, slug: r.entry.slug },
	);

type OrderedRelease = Extract<OrderedCopy, { readonly kind: "release" }>["release"];

/** The copies of one entry. */
export const copiesOfEntry = (copies: readonly OrderedCopy[], e: TimelineEntry): OrderedCopy[] =>
	copies.filter((c) => c.line === e.line && c.sha === e.sha && c.version === e.version);

/** An image copy's OS: an iOS release's label (`27.2 beta 2`), else its version. */
const imageOs = (r: OrderedRelease): string => r.label ?? r.version;

/** What names a source's versions: its copies, and the OS an OTA listing's train stands for. */
export interface VersionNaming {
	readonly platform: Platform;
	readonly copies: readonly OrderedCopy[];
	readonly otaOs: ReadonlyMap<string, string>;
}

export async function versionNaming(r: Located): Promise<VersionNaming> {
	const { platform } = r.ref;
	// Apple lists an OTA file under OS versions already; a Pixel under build trains.
	const otaOs =
		platform === "android" ? trainVersions(await releasesOf("android")) : new Map<string, string>();
	return { platform, copies: r.copies, otaOs };
}

/** An entry named by its copies' releases, as pages show it. */
export function nameVersion({ platform, copies, otaOs }: VersionNaming, e: TimelineEntry): Version {
	const naming = NAMING[platform];
	const mine = copiesOfEntry(copies, e);
	const shipped = mine
		.flatMap((c) => (c.kind === "release" ? [c.release] : []))
		.toSorted((a, b) => a.sortKey.localeCompare(b.sortKey));
	const files = mine.flatMap((c) => (c.kind === "ota" ? [c] : []));
	const carried = {
		images: shipped.map(imageOs),
		ota: files.flatMap((c) => c.os.map((os) => otaOs.get(os) ?? os)),
		version: e.version,
	};
	const held: VersionCopy[] = [
		...(shipped.length
			? [{ kind: "release" as const, releases: shipped.map((s) => s.id).toReversed() }]
			: []),
		...files.map((c) => ({ kind: "ota" as const, url: c.file.url, published: c.file.published, os: c.os })),
	];
	return { ...e, platform, label: naming.label(carried), icon: naming.icon(carried), copies: held };
}

export const versionOf = async (r: Located, entry: TimelineEntry): Promise<Version> =>
	nameVersion(await versionNaming(r), entry);

/** A version with its file decoded. */
interface DecodedVersion<T> extends Resolved {
	readonly file: T;
	readonly sha: string;
	readonly size: number;
}

type ReadVersion<T> = (v: Ver) => Promise<DecodedVersion<T>>;

/** A platform's versions read from the bucket and decoded, each once per request. */
export function decodedVersion<T>(platform: Platform, decode: (bytes: Uint8Array) => T): ReadVersion<T> {
	return perRequest(async (v: Ver): Promise<DecodedVersion<T>> => {
		const r = await resolve(v);
		if (r.ref.platform !== platform) error(400, `${v.source} is not a ${PLATFORM_NAMES[platform]} source.`);
		const bytes = await readBytes(keys.obj(r.entry.sha));
		if (!bytes) error(404, `Version ${r.entry.slug} is not in the bucket.`);
		return { ...r, file: decode(bytes), sha: r.entry.sha, size: bytes.length };
	}, verKey);
}

/** Two versions and what tells their files apart. */
export type VersionChanges<D> = { readonly a: Version | null; readonly b: Version } & D;

interface ChangeReaders<D> {
	/** A version against the one before it on its line, or against `against` on that line. */
	readonly changes: (v: Ver, against?: string) => Promise<VersionChanges<D>>;
	/** Any two versions; with no `a`, `b` against nothing. */
	readonly comparison: (av: Ver | null, bv: Ver) => Promise<VersionChanges<D>>;
}

export function versionChanges<T, D>(read: ReadVersion<T>, diff: (a: T | null, b: T) => D): ChangeReaders<D> {
	const named = async (v: Ver): Promise<Version> => {
		const r = await resolve(v);
		return versionOf(r, r.entry);
	};
	const comparison = async (av: Ver | null, bv: Ver): Promise<VersionChanges<D>> => {
		const [a, b, va, vb] = await Promise.all([
			av ? read(av) : null,
			read(bv),
			av ? named(av) : null,
			named(bv),
		]);
		return { a: va, b: vb, ...diff(a === null ? null : a.file, b.file) };
	};
	const changes = async (v: Ver, against?: string): Promise<VersionChanges<D>> => {
		const aSlug = against ?? (await resolve(v)).previous?.slug;
		return comparison(aSlug === undefined ? null : { ...v, slug: aSlug }, v);
	};
	return { changes, comparison };
}
