import { resolve } from "$app/paths";
import type { ReadonlyURL } from "$app/state";
import type { Path } from "$app/types";
import { isBigInt, isUid } from "@carrier-explode/decode-ios";
import { isRecord, type DiffKind } from "@carrier-explode/values";
import {
	buildPath,
	buildsPath,
	MAIN_LINE,
	modemPath,
	sourceKey,
	versionPath,
	type ReleasePlatform,
	type SourceRef,
} from "@carrier-explode/schema";
import type { At, Version } from "#lib/types.ts";

export function humanBytes(n: number): string {
	if (n < 1024) return n + " B";
	if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KiB";
	return (n / 1024 / 1024).toFixed(2) + " MiB";
}

function writeJson(x: unknown): string | undefined {
	if (isBigInt(x)) return x.__int;
	if (isUid(x)) return `UID(${x.__uid})`;
	if (Array.isArray(x)) return `[${x.map((y) => writeJson(y) ?? "null").join(",")}]`;
	if (isRecord(x)) {
		const items = Object.entries(x).flatMap(([k, y]) => {
			const s = writeJson(y);
			return s === undefined ? [] : [`${JSON.stringify(k)}:${s}`];
		});
		return `{${items.join(",")}}`;
	}
	// undefined and functions have no JSON form, as with JSON.stringify.
	const s: string | undefined = JSON.stringify(x);
	return s;
}

/** JSON with plist integers beyond 2^53 written as bare digits and UIDs as UID(n). */
export function plainJson(v: unknown): string {
	return writeJson(v) ?? String(v);
}

export function shortValue(v: unknown, max = 160): string {
	if (v === undefined) return "absent";
	if (v === null) return "null";
	const s = typeof v === "string" ? v : plainJson(v);
	return s.length > max ? s.slice(0, max) + "…" : s;
}

/** A diff's counts as a legend says them, the kinds with none left out: "3 changed, 11 removed". */
export const diffCounts = (counts: Readonly<Record<"changed" | "added" | "removed", number>>): string =>
	(["changed", "added", "removed"] as const)
		.flatMap((k) => (counts[k] ? [`${counts[k]} ${k}`] : []))
		.join(", ");

/** Chip class for each kind of difference. */
export const DIFF_CHIP: Record<DiffKind, string> = {
	added: "good",
	removed: "bad",
	changed: "warn",
	same: "",
};

const seg = encodeURIComponent;
const segs = (path: string): string => path.split("/").map(seg).join("/");

/** Every internal link goes through here so a configured base path is honoured. Paths come from this module or the schema's path builders. */
// oxlint-disable-next-line typescript/consistent-type-assertions -- SvelteKit types only route-shaped literals; these paths are built at runtime, and with this many routes TypeScript cannot check one against resolve's union of argument tuples.
export const link = (path: string): string => (resolve as (pathname: Path) => string)(path.slice(1) as Path);

export const buildsHref = (platform: ReleasePlatform): string => link(buildsPath(platform));

export const buildHref = (platform: ReleasePlatform, build: string): string =>
	link(buildPath(platform, build));

/** A modem a build ships, by its BuildModem id, or one of its tabs. */
export const modemHref = (platform: ReleasePlatform, build: string, modem: string, tab?: string): string =>
	link(modemPath(platform, build, modem) + (tab ? `/${tab}` : ""));

/** A version's page, on a tab, at a file. */
/** A version's tag in a version list: a beta is only ever a beta, even when its line has no release to call current. */
export function versionTag(
	e: Pick<Version, "slug" | "beta">,
	head: string,
): "current release" | "beta" | null {
	if (e.beta) return "beta";
	return e.slug === head ? "current release" : null;
}

export function versionHref(at: At, tab?: string, path?: string): string {
	const base = versionPath(at.ref, { line: at.line, slug: at.version });
	return link(base + (tab ? `/${tab}` : "") + (tab && path ? `/${segs(path)}` : ""));
}

/** One side of /compare: a source, at a version on a line, or at its head. */
export interface CompareSide {
	readonly source: SourceRef;
	readonly slug?: string | undefined;
	readonly line?: string | undefined;
}

/** /compare's query for two sides (`a=ios:carrier:ATT_US&av=72.0`, `b=android:carrier:att_us&bl=tokay&bv=79000000034`), narrowed to a file or not. */
export function compareHref(a: CompareSide | null, b: CompareSide | null, file?: string | null): string {
	const q = new URLSearchParams();
	for (const [p, s] of [
		["a", a],
		["b", b],
	] as const) {
		if (!s) continue;
		q.set(p, sourceKey(s.source));
		if (s.line) q.set(`${p}l`, s.line);
		if (s.slug) q.set(`${p}v`, s.slug);
	}
	if (file) q.set("file", file);
	return link("/compare") + (q.size ? "?" + q : "");
}

/** The query args naming a version. */
export const verArgs = (at: At): { source: string; line?: string; slug: string } =>
	at.line === MAIN_LINE
		? { source: sourceKey(at.ref), slug: at.version }
		: { source: sourceKey(at.ref), line: at.line, slug: at.version };

/** Only images and audio: the pages embed those, every other file is shown decoded. */
export const rawHref = (at: At, path: string): string =>
	link(`/raw${versionPath(at.ref, { line: at.line, slug: at.version })}/${segs(path)}`);

/** A property of anything, an Error or a framework's error object included. */
const field = (v: unknown, key: string): unknown =>
	typeof v === "object" && v !== null && key in v ? Reflect.get(v, key) : undefined;

export function errorMessage(e: unknown): string {
	const said = [field(field(e, "body"), "message"), field(e, "message")].find(
		(m): m is string => typeof m === "string",
	);
	if (said) return said;
	// String() on a bare object gives "[object Object]", which says nothing.
	let shape: string;
	try {
		shape = typeof e === "object" && e !== null ? JSON.stringify(e) : String(e);
	} catch {
		shape = String(e);
	}
	const status = field(e, "status");
	return typeof status === "number" && status ? `HTTP ${status} · ${shape}` : `Unexpected error: ${shape}`;
}

/** The first 32 bytes of a hex string; some defaults are whole tables, and the name says what they are. */
export const shortHex = (hex: string): string => (hex.length > 64 ? hex.slice(0, 64) + "…" : hex);

export function hexDump(hex: string, withOffsets = false): string {
	return (hex.match(/.{1,32}/g) ?? [])
		.map((g, i) => {
			const bytes = g.match(/.{1,2}/g) ?? [];
			if (!withOffsets) return bytes.join(" ");
			const ascii = bytes
				.map((b) => {
					const c = parseInt(b, 16);
					return c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
				})
				.join("");
			return (i * 16).toString(16).padStart(6, "0") + "  " + bytes.join(" ").padEnd(47) + "  " + ascii;
		})
		.join("\n");
}

/** Same URL with some search params changed; empty values are dropped. */
export function withParams(url: ReadonlyURL, changes: Record<string, string | null>): string {
	const next = new URLSearchParams(url.search);
	for (const [k, v] of Object.entries(changes)) {
		if (v) next.set(k, v);
		else next.delete(k);
	}
	const q = next.toString();
	return url.pathname + (q ? "?" + q : "");
}
