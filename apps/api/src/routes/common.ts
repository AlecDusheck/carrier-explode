/** What every route declares alike: its JSON answer, the errors it can give, and the parameters routes share. */

import { z } from "@hono/zod-openapi";
import {
	DEVICE_CODE,
	ISO_CODE,
	isSourceKey,
	isVersionSlug,
	PLATFORMS,
	RELEASE_ID,
	RELEASE_PLATFORMS,
	type SourceKey,
} from "@carrier-explode/schema/types";
import { errorSchema } from "../context.ts";
import { PROFILE_FIELDS, type ProfileField } from "../shapes.ts";

interface JsonAnswer<S extends z.ZodType> {
	readonly description: string;
	readonly content: { "application/json": { schema: S } };
}

export const json = <S extends z.ZodType>(schema: S, description: string): { 200: JsonAnswer<S> } => ({
	200: { description, content: { "application/json": { schema } } },
});

const error = (description: string): JsonAnswer<typeof errorSchema> => ({
	description,
	content: { "application/json": { schema: errorSchema } },
});

export const ERRORS = {
	400: error("A parameter is malformed, or the query names one the route does not take."),
	404: error(
		"Nothing by that name; something only just extracted appears once its build or file is indexed.",
	),
	429: error("Over the per-IP budget; retry after the Retry-After seconds."),
};

/** No parameters but the path's: anything else is a 400, so one resource has one URL. */
export const NO_QUERY = z.object({}).strict();

export const platformParam = z.enum(PLATFORMS).openapi({ description: "The OS that ships the settings." });
export const releasePlatformParam = z.enum(RELEASE_PLATFORMS).openapi({
	description:
		"A platform whose OS images are read: `ios` (iPhone), `android` (Pixel) or `samsung` (Galaxy).",
});

/** A device's code, which is also the line of versions a source ships for it. */
export const deviceParam = z.string().regex(DEVICE_CODE).openapi({
	description:
		"An iPhone's product type (`iPhone18,1`), a Pixel's codename (`tokay`) or a Galaxy's model number (`SM-S948U`).",
	example: "iPhone18,1",
});

export const buildParam = z.string().regex(RELEASE_ID).openapi({
	description:
		"An iOS build (`24A437`), a Pixel build id (`CP3A.260905.009`) or a Galaxy build (`S948USQS4AZHL`).",
	example: "24A437",
});

export const isoParam = z
	.string()
	.regex(ISO_CODE)
	.openapi({ description: "ISO 3166 alpha-2, lower case.", example: "us" });

export const carrierParam = z.string().min(1).max(200).openapi({
	description: "A carrier's id, as `/v1/carriers` lists it.",
	example: "ATT_US",
});

export const searchParam = z.string().min(1).max(100);

export const sourceKeyParam = z
	.string()
	.max(250)
	.refine((s): s is SourceKey => isSourceKey(s), "a source key, `<platform>:<kind>:<name>`")
	.openapi({ description: "A source key, `<platform>:<kind>:<name>`.", example: "ios:carrier:ATT_US" });

const LATEST = "latest";

export const versionParam = z
	.string()
	.refine((s) => s === LATEST || isVersionSlug(s), "a version slug (`72.0`, `50.1@2022-04-12`) or `latest`")
	.openapi({
		description: "A version slug from the source's versions, or `latest` for the line's newest non-beta.",
		example: LATEST,
	});

/** A slug, or undefined for the line's head. */
export const slugOf = (version: string): string | undefined => (version === LATEST ? undefined : version);

export const lineParam = deviceParam.openapi({
	description:
		"The device whose line to read: a Pixel's codename or a Galaxy's model number (default: the newest), or an Apple model's product type for a model-specific bundle (default: the main line).",
	example: "tokay",
});

const FIELDS = new RegExp(`^(?:${PROFILE_FIELDS.join("|")})(?:,(?:${PROFILE_FIELDS.join("|")}))*$`);
const isProfileField = (s: string): s is ProfileField => PROFILE_FIELDS.some((f) => f === s);

export const fieldsParam = z
	.string()
	.regex(FIELDS)
	.optional()
	.transform(
		(s): ReadonlySet<ProfileField> =>
			new Set(s === undefined ? PROFILE_FIELDS : s.split(",").filter(isProfileField)),
	)
	.openapi({
		description: `The profile's fields to answer, comma-separated: ${PROFILE_FIELDS.map((f) => `\`${f}\``).join(", ")} (default: all).`,
		example: "apns",
	});
