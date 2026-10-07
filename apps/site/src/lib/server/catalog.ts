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
	decoderFamily,
	MAIN_LINE,
	parseSourceKey,
	sourceKey,
	sourcePath,
	versionPath,
	type DecoderFamily,
	type EntryRef,
	type Platform,
	type ReleasePlatform,
	type SourceKey,
	type SourceRef,
} from "@carrier-explode/schema/types";
import { trainVersions } from "#lib/android/naming.ts";
import { NAMING } from "#lib/naming.ts";
import type { Ver, Version, VersionCopy } from "#lib/types.ts";
import { perRequest } from "./cache";
import { db, everyPage } from "./db";
import type { PicturedCarrier } from "./pictures";

/** Whose devices a family's lines are: Apple's models are iPhones, as its images are. */
const LINE_DEVICES = { apple: "ios", android: "android", samsung: "samsung" } as const satisfies Record<
	DecoderFamily,
	ReleasePlatform
>;

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
	deviceList(await db(), platform),
);

/** Each device's name, by code. */
export const deviceNames = perRequest(
	async (platform: ReleasePlatform): Promise<ReadonlyMap<string, string>> =>
		new Map((await devicesOf(platform)).map((d) => [d.code, d.name])),
);

/** The names of the devices a platform's lines are, by code. */
export const lineNames = (platform: Platform): Promise<ReadonlyMap<string, string>> =>
	deviceNames(LINE_DEVICES[decoderFamily(platform)]);

/** The order a platform's lines are listed in: its devices, newest first. */
export const deviceOrder = async (platform: Platform): Promise<DeviceOrder> =>
	newestFirst(await devicesOf(LINE_DEVICES[decoderFamily(platform)]));

/** A platform's releases, newest first. */
export const releasesOf = perRequest(async (platform: ReleasePlatform): Promise<ListedRelease[]> => {
	const d = await db();
	return everyPage(
		(page: Page<string>) => releaseList(d, platform, page),
		(r) => r.sortKey,
	);
});

/** A release's modems as the index has them, each family named. */
export type ShippedModem = ModemRow & { readonly familyName: string };

export const shippedModems = perRequest(
	async (platform: ReleasePlatform, build: string): Promise<ShippedModem[]> =>
		modemsOf(await db(), platform, build),
);

const sourceRow = perRequest(async (key: SourceKey) => sourceOf(await db(), key));

type SourceHeader = NonNullable<Awaited<ReturnType<typeof sourceRow>>>;

export const isIndexed = async (key: SourceKey): Promise<boolean> => (await sourceRow(key)) !== undefined;

/** A source's carrier with its members; null until the link step has linked it, and for a country bundle. */
export const carrierOfSource = async (key: SourceKey): Promise<PicturedCarrier | null> => {
	const s = await sourceRow(key);
	return s === undefined || s.carrier === null || s.carrierName === null
		? null
		: { id: s.carrier, name: s.carrierName, members: s.members };
};

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
}

/** `key` is untrusted: it comes from a URL or a query argument. */
export const locate = perRequest(async (key: string): Promise<Located> => {
	const ref = parseSourceKey(key);
	if (!ref) error(400, `Not a source key: ${key}`);
	const typed = sourceKey(ref);
	const [source, timeline, order] = await Promise.all([
		sourceRow(typed),
		db().then((d) => entriesOf(d, typed)),
		deviceOrder(ref.platform),
	]);
	if (!source) error(404, `No ${ref.name} on ${ref.platform}.`);
	return { key: typed, ref, source, timeline, order };
});

/** A Ver from the strings a per-request cache keys by, where "" is a missing line or version. */
export const verFrom = (source: string, line: string, slug: string): Ver => ({
	source,
	...(line ? { line } : {}),
	...(slug ? { slug } : {}),
});

/** A resolved version as query args again: Apple's main line has no line segment. */
export const verAt = (source: string, at: EntryRef): Ver =>
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

/** Every copy of a source: what names its versions, and a version page's "Shipped in". */
export const copiesOfSource = perRequest(async (key: SourceKey, platform: Platform): Promise<OrderedCopy[]> =>
	copiesOf(await db(), key, platform),
);

type OrderedRelease = Extract<OrderedCopy, { readonly kind: "release" }>["release"];

/** The copies of one entry. */
export const copiesOfEntry = (copies: readonly OrderedCopy[], e: TimelineEntry): OrderedCopy[] =>
	copies.filter((c) => c.line === e.line && c.sha === e.sha && c.version === e.version);

/** An image copy's OS: an iOS release's label (`27.2 beta 2`), else its version. */
const imageOs = (r: OrderedRelease): string => r.label ?? r.version;

/** Entries named by their copies' releases, as pages show them. */
export async function versionsOf(r: Located, entries: readonly TimelineEntry[]): Promise<Version[]> {
	const { platform } = r.ref;
	const copies = await copiesOfSource(r.key, platform);
	const naming = NAMING[platform];
	// Apple lists an OTA file under OS versions already; a Pixel under build trains.
	const otaOs =
		platform === "android" ? trainVersions(await releasesOf("android")) : new Map<string, string>();
	return entries.map((e) => {
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
	});
}

export async function versionOf(r: Located, entry: TimelineEntry): Promise<Version> {
	const [v] = await versionsOf(r, [entry]);
	if (!v) error(500, `no version for ${entry.slug}`);
	return v;
}
