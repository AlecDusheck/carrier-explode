/**
 * Keyset pages: a list resumes after its last row's key in the index's own order, never at an offset, so each page reads
 * about `limit` rows and a cursor names the same page until a publish changes the list. A query has one spelling, so one
 * page is one URL and one cache entry.
 */

import { z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { After } from "@carrier-explode/db/d1";
import { fail, type ApiContext, type ApiEnv } from "./context.ts";

export const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** A page's query parameters. */
export const pageQuery = {
  cursor: z.string().regex(/^[\w-]{1,400}$/).optional().openapi({ description: "The `next.cursor` of the previous page." }),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).openapi({ description: `Items per page, at most ${MAX_LIMIT}.` }),
};

export interface PageArgs {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

/** A page of items, and where the next one starts; null on the last. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly next: { readonly cursor: string; readonly url: string } | null;
}

/** The one spelling of a query: keys in order, the default limit left out. */
export function canonicalSearch(params: URLSearchParams): string {
  const kept = new URLSearchParams([...params].filter(([k, v]) => !(k === "limit" && v === String(DEFAULT_LIMIT))));
  kept.sort();
  const search = kept.toString();
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

/** What a list's key is, and how a cursor carries it. */
export interface KeyCodec<K extends string | number> {
  readonly is: (x: unknown) => x is K;
}

export const STRING_KEY: KeyCodec<string> = { is: (x): x is string => typeof x === "string" };
export const NUMBER_KEY: KeyCodec<number> = { is: (x): x is number => Number.isSafeInteger(x) };

const base64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

export const encodeCursor = (key: string | number): string => base64url(new TextEncoder().encode(JSON.stringify(key)));

/** The key a cursor carries; a cursor this API did not write is a 400. */
export function decodeCursor<K extends string | number>(cursor: string, codec: KeyCodec<K>): K {
  try {
    const bytes = Uint8Array.from(atob(cursor.replaceAll("-", "+").replaceAll("_", "/")), (ch) => ch.charCodeAt(0));
    const key: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (codec.is(key)) return key;
  } catch {
    // Falls through to the 400: what failed to parse is the client's cursor.
  }
  throw fail(400, "Not a cursor this API wrote: pass `next.cursor` from the previous page as it is.");
}

/** One page of a list read by keyset: `read` returns rows after a key in order, `keyOf` a row's key. */
export async function paged<K extends string | number, T, R>(
  c: ApiContext,
  args: PageArgs,
  codec: KeyCodec<K>,
  read: (page: After<K>) => Promise<readonly T[]>,
  keyOf: (row: T) => K,
  show: (rows: readonly T[]) => Promise<readonly R[]> | readonly R[],
): Promise<Page<R>> {
  const after = args.cursor === undefined ? null : decodeCursor(args.cursor, codec);
  // One row past the page says whether another follows.
  const rows = await read({ after, take: args.limit + 1 });
  const shown = rows.slice(0, args.limit);
  const last = shown.at(-1);
  if (rows.length <= args.limit || last === undefined) return { items: await show(shown), next: null };
  const cursor = encodeCursor(keyOf(last));
  const url = new URL(c.req.url);
  url.searchParams.set("cursor", cursor);
  url.search = canonicalSearch(url.searchParams);
  return { items: await show(shown), next: { cursor, url: url.href } };
}
