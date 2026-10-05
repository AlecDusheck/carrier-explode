/** What every route declares alike: its JSON answer, the errors it can give, and the parameters several share. */

import { z } from "@hono/zod-openapi";
import { PLATFORMS, RELEASE_PLATFORMS } from "@carrier-explode/schema/types";
import { errorSchema } from "../context.ts";

interface JsonAnswer<S extends z.ZodType> {
  readonly description: string;
  readonly content: { "application/json": { schema: S } };
}

export const json = <S extends z.ZodType>(schema: S, description: string): { 200: JsonAnswer<S> } =>
  ({ 200: { description, content: { "application/json": { schema } } } });

const error = (description: string): JsonAnswer<typeof errorSchema> => ({ description, content: { "application/json": { schema: errorSchema } } });

export const ERRORS = {
  400: error("A parameter is malformed, or the query names one the route does not take."),
  404: error("Nothing by that name; something only just published appears after the next index run."),
  429: error("Over the per-IP budget; retry after the Retry-After seconds."),
};

/** No parameters but the path's: anything else is a 400, so one resource has one URL. */
export const NO_QUERY = z.object({}).strict();

export const platformParam = z.enum(PLATFORMS).openapi({ description: "The OS that ships the settings." });
export const releasePlatformParam = z.enum(RELEASE_PLATFORMS).openapi({ description: "A platform whose OS images are read: `ios` (iPhone) or `android` (Pixel)." });
