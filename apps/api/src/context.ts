/** What every handler shares: the bindings, the request's index session and whether its URL pins a version, and the one error shape. */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { IndexDb } from "@carrier-explode/db";

export interface ApiEnv {
	readonly Bindings: Env;
	readonly Variables: {
		readonly db: IndexDb;
		/** Set when the URL names a fixed version, whose answer never changes under it. */
		pinned: boolean;
	};
}

export type ApiContext = Context<ApiEnv>;

/** A machine-readable name per status the API answers with. */
const ERROR_CODES = {
	400: "bad_request",
	401: "unauthorized",
	404: "not_found",
	500: "internal",
	502: "bad_gateway",
} as const satisfies Partial<Record<ContentfulStatusCode, string>>;

export type ErrorStatus = keyof typeof ERROR_CODES;

export const errorSchema = z
	.object({
		error: z.object({
			status: z.number().int(),
			code: z.enum(ERROR_CODES),
			message: z.string(),
		}),
	})
	.openapi("Error");

export type ErrorBody = z.output<typeof errorSchema>;

export const errorBody = (status: ErrorStatus, message: string): ErrorBody => ({
	error: { status, code: ERROR_CODES[status], message },
});

const isErrorStatus = (status: number): status is ErrorStatus => status in ERROR_CODES;

/** An HTTPException's status as the error shape names it; any other is the API's own failure. */
export const errorStatus = (status: number): ErrorStatus => (isErrorStatus(status) ? status : 500);

/** Thrown from a handler; the app's onError answers it in the error shape. */
export const fail = (status: ErrorStatus, message: string): HTTPException =>
	new HTTPException(status, { message });

/** A router whose bad parameters answer 400 in the error shape. */
export const router = (): OpenAPIHono<ApiEnv> =>
	new OpenAPIHono<ApiEnv>({
		defaultHook: (result, c) =>
			result.success ? undefined : c.json(errorBody(400, z.prettifyError(result.error)), 400),
	});
