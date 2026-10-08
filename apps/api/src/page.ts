/**
 * Keyset pages: a list resumes after its last row's key, never at an offset, so each page reads about `limit` rows.
 * A query has one spelling, so one page is one URL and one cache entry.
 */

import { z } from "@hono/zod-openapi";
import { env } from "cloudflare:workers";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { Page as Window } from "@carrier-explode/db";
import { isSourceKey, type SourceKey } from "@carrier-explode/schema/types";
import { fail, type ApiContext, type ApiEnv } from "./context.ts";

const { default: DEFAULT_LIMIT, max: MAX_LIMIT } = env.API_PAGE_LIMITS;

export const pageQuery = {
	cursor: z
		.string()
		.regex(/^[\w-]{1,400}$/)
		.optional()
		.openapi({ description: "The `next.cursor` of the previous page." }),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(MAX_LIMIT)
		.default(DEFAULT_LIMIT)
		.openapi({ description: `Items per page, at most ${MAX_LIMIT}.` }),
};

export interface PageArgs {
	readonly cursor?: string | undefined;
	readonly limit: number;
}

/** The one spelling of a query: keys in order, the default limit left out, `,` and `:` as typed. */
export function canonicalSearch(params: URLSearchParams): string {
	const kept = new URLSearchParams(
		[...params].filter(([k, v]) => !(k === "limit" && v === String(DEFAULT_LIMIT))),
	);
	kept.sort();
	const search = kept.toString().replaceAll("%2C", ",").replaceAll("%3A", ":");
	return search ? `?${search}` : "";
}

/** Any other spelling of a GET's query redirects to the canonical one. */
export const canonical: MiddlewareHandler<ApiEnv> = createMiddleware<ApiEnv>(async (c, next) => {
	const url = new URL(c.req.url);
	const search = canonicalSearch(url.searchParams);
	if (c.req.method === "GET" && url.search !== search) {
		url.search = search;
		return c.redirect(url.href, 308);
	}
	return next();
});

/** Which strings a list's cursor may carry as its key. */
export type KeyCodec<K extends string> = (key: string) => key is K;

export const STRING_KEY: KeyCodec<string> = (key): key is string => key.length > 0;
export const SOURCE_KEY: KeyCodec<SourceKey> = isSourceKey;

const base64url = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");

export const encodeCursor = (key: string): string => base64url(new TextEncoder().encode(JSON.stringify(key)));

/** The key a cursor carries; a cursor this API did not write is a 400. */
export function decodeCursor<K extends string>(cursor: string, codec: KeyCodec<K>): K {
	try {
		const bytes = Uint8Array.from(atob(cursor.replaceAll("-", "+").replaceAll("_", "/")), (ch) =>
			ch.charCodeAt(0),
		);
		const key: unknown = JSON.parse(new TextDecoder().decode(bytes));
		if (typeof key === "string" && codec(key)) return key;
	} catch {
		// Falls through to the 400: what failed to parse is the client's cursor.
	}
	throw fail(400, "Not a cursor this API wrote: pass `next.cursor` from the previous page as it is.");
}

/** One page of a list read by keyset: `read` returns rows after a key in order, `keyOf` a row's key. */
export async function paged<K extends string, T, R = T>(
	c: ApiContext,
	args: PageArgs,
	codec: KeyCodec<K>,
	read: (window: Window<K>) => Promise<readonly T[]>,
	keyOf: (row: T) => K,
	show: (row: T) => R,
): Promise<{
	readonly items: readonly R[];
	readonly next: { readonly cursor: string; readonly url: string } | null;
}> {
	const after = args.cursor === undefined ? null : decodeCursor(args.cursor, codec);
	// One row past the page says whether another follows.
	const rows = await read({ after, take: args.limit + 1 });
	const shown = rows.slice(0, args.limit);
	const items = shown.map(show);
	const last = shown.at(-1);
	if (rows.length <= args.limit || last === undefined) return { items, next: null };
	const cursor = encodeCursor(keyOf(last));
	const url = new URL(c.req.url);
	url.searchParams.set("cursor", cursor);
	url.search = canonicalSearch(url.searchParams);
	return { items, next: { cursor, url: url.href } };
}

/** A window of a list read whole, for lists the index answers in one read (a line's versions, a platform's phones). */
export function windowOf<K extends string, T>(
	rows: readonly T[],
	keyOf: (row: T) => K,
	window: Window<K>,
): readonly T[] {
	const from = window.after === null ? 0 : rows.findIndex((r) => keyOf(r) === window.after) + 1;
	if (from === 0 && window.after !== null)
		throw fail(400, `${window.after} is no longer in this list: start again without a cursor.`);
	return rows.slice(from, from + window.take);
}
