/**
 * Old URLs moved for good (301) to the page that now holds what they named; a stand-in that may change, an iPad file's
 * iOS carrier or the source of a version the index lacks, is found (302).
 */

import {
	isPlatform,
	KIND_SEGMENTS,
	SEGMENT_KIND,
	shipsKind,
	sourcePath,
	type Platform,
	type SourceRef,
} from "@carrier-explode/schema/types";

type Target =
	| { readonly kind: "list"; readonly path: string }
	| { readonly kind: "source"; readonly ref: SourceRef }
	| { readonly kind: "country"; readonly platform: Platform; readonly iso: string }
	| { readonly kind: "build"; readonly id: string }
	| { readonly kind: "article"; readonly path: string };

/** Where an old URL goes: for good (301), or to a stand-in that may change (302). */
interface Move {
	readonly target: Target;
	readonly status: 301 | 302;
}
const forGood = (target: Target): Move => ({ target, status: 301 });
const standIn = (target: Target): Move => ({ target, status: 302 });

/** What the index and the wiki hold; a list always renders. */
export interface Held {
	readonly source: (ref: SourceRef) => Promise<boolean>;
	/** The country file a platform ships for a country code, or null. */
	readonly countryFile: (platform: Platform, iso: string) => Promise<string | null>;
	/** Whether a platform that ships no country files has carriers in a country, which its country page lists. */
	readonly carriersIn: (platform: Platform, iso: string) => Promise<boolean>;
	readonly build: (id: string) => Promise<boolean>;
	readonly article: (path: string) => boolean;
}

const list = (path: string): Target => ({ kind: "list", path });
const source = (platform: Platform, kind: SourceRef["kind"], name: string): Target => ({
	kind: "source",
	ref: { platform, kind, name },
});
const build = (id: string | undefined): Target =>
	id === undefined ? list("/ios/builds") : { kind: "build", id };

const COUNTRY_CODE = /^[a-z]{2}$/i;

/** A country as an old URL named it: its file's name, or its ISO code in either case. */
const country = (platform: Platform, name: string): Target =>
	COUNTRY_CODE.test(name)
		? { kind: "country", platform, iso: name.toLowerCase() }
		: source(platform, "country", name);

/**
 * v1 was iOS's alone, with iPad OTA files as versions (`ota-58.1-iPad`) and watch bundles under /watch.
 * No current route starts so. The first candidate held wins.
 */
function v1Moves(path: readonly string[]): readonly Move[] {
	const [first, second, third] = path;
	switch (first) {
		case "carriers":
			if (second === undefined) return [forGood(list("/ios/carriers"))];
			return third?.startsWith("ota-") && third.endsWith("-iPad")
				? [forGood(source("ipados", "carrier", second)), standIn(source("ios", "carrier", second))]
				: [forGood(source("ios", "carrier", second))];
		case "countries":
			return [forGood(second === undefined ? list("/ios/countries") : country("ios", second))];
		case "watch":
			return [
				forGood(second === undefined ? list("/watchos/carriers") : source("watchos", "carrier", second)),
			];
		case "cell-broadcast":
			return [forGood(list("/ios/countries"))];
		case "releases":
		case "baseband":
		case "builds":
			return [forGood(build(second))];
		case "wiki":
			return second !== undefined && third === undefined
				? [forGood({ kind: "article", path: `ios/${second}` })]
				: [];
		default:
			return [];
	}
}

/** A current-shape URL that 404'd: a country by its code, or a version or line the index lacks below a source. */
function currentMoves(path: readonly string[]): readonly Move[] {
	const [first, second, third] = path;
	const kind = KIND_SEGMENTS.find((k) => k === second);
	if (first === undefined || !isPlatform(first) || kind === undefined || third === undefined) return [];
	if (SEGMENT_KIND[kind] === "country" && COUNTRY_CODE.test(third)) return [forGood(country(first, third))];
	return path.length < 4 ? [] : [standIn(source(first, SEGMENT_KIND[kind], third))];
}

/** Where a target's page is, or null when nothing holds it. */
async function located(t: Target, held: Held): Promise<string | null> {
	switch (t.kind) {
		case "list":
			return t.path;
		case "source":
			return (await held.source(t.ref)) ? sourcePath(t.ref) : null;
		case "country": {
			if (!shipsKind(t.platform, "country"))
				return (await held.carriersIn(t.platform, t.iso)) ? `/${t.platform}/countries/${t.iso}` : null;
			const name = await held.countryFile(t.platform, t.iso);
			return name === null ? null : sourcePath({ platform: t.platform, kind: "country", name });
		}
		case "build":
			return (await held.build(t.id)) ? `/ios/builds/${encodeURIComponent(t.id)}` : null;
		case "article":
			return held.article(t.path) ? `/wiki/${t.path}` : null;
	}
}

async function firstLocated(
	moves: readonly Move[],
	held: Held,
): Promise<{ readonly path: string; readonly status: Move["status"] } | null> {
	for (const { target, status } of moves) {
		const path = await located(target, held);
		if (path !== null) return { path, status };
	}
	return null;
}

/** A malformed escape names no old page. */
function segments(pathname: string): string[] | null {
	try {
		return pathname
			.split("/")
			.slice(1)
			.filter((s) => s !== "")
			.map(decodeURIComponent);
	} catch {
		return null;
	}
}

const moved = (to: { readonly path: string; readonly status: Move["status"] }, search: string): Response =>
	new Response(null, { status: to.status, headers: { location: to.path + search } });

/** A v1 URL is answered before routing, so a crawl of them renders nothing; a current-shape one only once it has 404'd. */
export async function repair(
	request: Request,
	on: boolean,
	held: Held,
	resolve: () => Promise<Response>,
): Promise<Response> {
	if (!on || (request.method !== "GET" && request.method !== "HEAD")) return resolve();
	const url = new URL(request.url);
	const path = segments(url.pathname);
	if (path === null) return resolve();
	const v1 = await firstLocated(v1Moves(path), held);
	if (v1 !== null) return moved(v1, url.search);
	const response = await resolve();
	const to = response.status === 404 ? await firstLocated(currentMoves(path), held) : null;
	return to === null || to.path === url.pathname ? response : moved(to, url.search);
}
