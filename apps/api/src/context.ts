/** What every handler shares: the bindings, the request's index session and what its response read, and the one error shape. */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { IndexDb } from "@carrier-explode/db/d1";
import type { SourceKey } from "@carrier-explode/schema/types";

export interface ApiEnv {
  readonly Bindings: Env;
  readonly Variables: {
    readonly db: IndexDb;
    /** The sources the response read: its cache tags, so a publish purges only what it changed. */
    readonly sources: Set<SourceKey>;
    /** Set when the URL names a fixed version, whose answer never changes under it. */
    pinned: boolean;
  };
}

export type ApiContext = Context<ApiEnv>;

export const errorSchema = z.object({
  error: z.object({ status: z.number().int(), message: z.string() }),
}).openapi("Error");

export type ErrorBody = z.output<typeof errorSchema>;

export const errorBody = (status: number, message: string): ErrorBody => ({ error: { status, message } });

/** Thrown from a handler; the app's onError answers it in the error shape. */
export const fail = (status: ContentfulStatusCode, message: string): HTTPException => new HTTPException(status, { message });

/** A router whose bad parameters answer 400 in the error shape. */
export const router = (): OpenAPIHono<ApiEnv> =>
  new OpenAPIHono<ApiEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(errorBody(400, z.prettifyError(result.error)), 400)),
  });
