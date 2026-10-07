/** Carriers, linked across platforms: their sources, feature states, decoded heads and modem configurations; and countries. */

import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
	carrierList,
	carrierModemConfigs,
	carrierOf,
	carrierSources,
	carrierStates,
	countryCarriers,
	countryList,
	countryOf,
} from "@carrier-explode/db";
import { FEATURE_SLUGS } from "@carrier-explode/schema";
import { PLATFORMS } from "@carrier-explode/schema/types";
import { fail, router, type ApiContext, type ApiEnv } from "../context.ts";
import { pageQuery, paged, STRING_KEY } from "../page.ts";
import { budget } from "../rate.ts";
import {
	carrierFeaturesSchema,
	carrierModemsSchema,
	carrierPageSchema,
	carrierProfilesSchema,
	carrierSchema,
	countryPageSchema,
	countrySchema,
} from "../shapes.ts";
import { headsOf, profileOf, selected } from "../versions.ts";
import {
	carrierParam,
	deviceParam,
	ERRORS,
	fieldsParam,
	isoParam,
	json,
	NO_QUERY,
	searchParam,
} from "./common.ts";
import { deviceRef } from "./devices.ts";
import { statePhones } from "./features.ts";

const ofCarrier = z.object({ id: carrierParam });

async function mustCarrier(
	c: ApiContext,
	id: string,
): Promise<NonNullable<Awaited<ReturnType<typeof carrierOf>>>> {
	const carrier = await carrierOf(c.var.db, id);
	if (!carrier) throw fail(404, `No carrier ${id}: /v1/carriers?q= finds one by any of its names.`);
	return carrier;
}

export const carriers: OpenAPIHono<ApiEnv> = router();

carriers.openapi(
	createRoute({
		method: "get",
		path: "/carriers",
		operationId: "listCarriers",
		tags: ["Carriers"],
		summary: "Carriers across platforms, by id",
		middleware: [budget("base")],
		request: {
			query: z
				.object({
					...pageQuery,
					q: searchParam.optional().openapi({
						description:
							"Part of its name or id, or of any of its sources' native names (`att_us`, a sales code), in any case.",
						example: "verizon",
					}),
					country: isoParam.optional(),
					platform: z
						.enum(PLATFORMS)
						.optional()
						.openapi({ description: "Only carriers with a source on it." }),
				})
				.strict(),
		},
		responses: { ...json(carrierPageSchema, "A page of carriers, by id."), ...ERRORS },
	}),
	async (c) => {
		const { q, country, platform, ...page } = c.req.valid("query");
		const filter = { q: q ?? null, country: country ?? null, platform: platform ?? null };
		return c.json(
			await paged(
				c,
				page,
				STRING_KEY,
				(w) => carrierList(c.var.db, w, filter),
				(r) => r.id,
				(r) => r,
			),
			200,
		);
	},
);

carriers.openapi(
	createRoute({
		method: "get",
		path: "/carriers/{id}",
		operationId: "getCarrier",
		tags: ["Carriers"],
		summary: "A carrier: its sources on every platform, each with its head version",
		middleware: [budget("base")],
		request: { params: ofCarrier, query: NO_QUERY },
		responses: { ...json(carrierSchema, "The carrier."), ...ERRORS },
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const [{ members, ...carrier }, rows] = await Promise.all([
			mustCarrier(c, id),
			carrierSources(c.var.db, id),
		]);
		const heads = await headsOf(c, rows);
		const byKey = new Map(rows.map((r) => [r.key, r]));
		const sources = members.map((key) => {
			const row = byKey.get(key);
			const at = heads.get(key);
			if (row === undefined || at === undefined) throw new Error(`${id}: member ${key} has no source row`);
			return {
				key,
				platform: row.platform,
				kind: row.kind,
				name: row.name,
				updated: row.updated,
				head: { line: at.line, slug: at.slug, version: at.version },
			};
		});
		return c.json({ ...carrier, sources }, 200);
	},
);

carriers.openapi(
	createRoute({
		method: "get",
		path: "/carriers/{id}/features",
		operationId: "getCarrierFeatures",
		tags: ["Carriers"],
		summary: "Each of its sources' feature states on each platform's newest phone, or on the phone named",
		middleware: [budget("base")],
		request: {
			params: ofCarrier,
			query: z
				.object({
					feature: z.enum(FEATURE_SLUGS).optional().openapi({ description: "Only this feature's state." }),
					device: deviceParam.optional().openapi({
						description: "The phone to read them on (default: each platform's newest that reads any).",
					}),
				})
				.strict(),
		},
		responses: {
			...json(
				carrierFeaturesSchema,
				"Per source and phone; a source that ships nothing for a phone is absent.",
			),
			...ERRORS,
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const { feature, device } = c.req.valid("query");
		const [, phones] = await Promise.all([mustCarrier(c, id), statePhones(c, device, undefined)]);
		const byCode = new Map(phones.map((p) => [p.code, p]));
		const rows = await carrierStates(
			c.var.db,
			id,
			phones.map((p) => p.code),
		);
		const only = <T>(record: Readonly<Record<string, T>>): Readonly<Record<string, T>> =>
			feature === undefined
				? record
				: Object.fromEntries(Object.entries(record).filter(([k]) => k === feature));
		const items = rows.map((r) => {
			const phone = byCode.get(r.device);
			if (phone === undefined) throw new Error(`${id}: states for ${r.device}, which was not asked for`);
			return {
				source: r.source,
				device: deviceRef(phone),
				states: only(r.states),
				defaults: only(r.defaults),
			};
		});
		return c.json({ items }, 200);
	},
);

carriers.openapi(
	createRoute({
		method: "get",
		path: "/carriers/{id}/profiles",
		operationId: "getCarrierProfiles",
		tags: ["Carriers"],
		summary: "Each of its sources' head version, decoded: identity, APNs, concepts and variants",
		middleware: [budget("bundle")],
		request: { params: ofCarrier, query: z.object({ fields: fieldsParam }).strict() },
		responses: { ...json(carrierProfilesSchema, "One per source, by key."), ...ERRORS },
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const { fields } = c.req.valid("query");
		const [{ members }, rows] = await Promise.all([mustCarrier(c, id), carrierSources(c.var.db, id)]);
		const heads = await headsOf(c, rows);
		const items = await Promise.all(
			members.map(async (key) => {
				const at = heads.get(key);
				if (at === undefined) throw new Error(`${id}: member ${key} has no head`);
				const profile = await profileOf(c, key, at.sha);
				return {
					source: key,
					line: at.line,
					slug: at.slug,
					version: at.version,
					profile: selected(profile, fields),
				};
			}),
		);
		return c.json({ items }, 200);
	},
);

carriers.openapi(
	createRoute({
		method: "get",
		path: "/carriers/{id}/modems",
		operationId: "getCarrierModems",
		tags: ["Carriers"],
		summary:
			"Pixel and Galaxy modem configurations its SIMs select, per firmware of each device's newest build that ships a modem",
		middleware: [budget("base")],
		request: { params: ofCarrier, query: NO_QUERY },
		responses: {
			...json(carrierModemsSchema, "The configurations, by platform, firmware and label."),
			...ERRORS,
		},
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const [, items] = await Promise.all([mustCarrier(c, id), carrierModemConfigs(c.var.db, id)]);
		return c.json({ items }, 200);
	},
);

carriers.openapi(
	createRoute({
		method: "get",
		path: "/countries",
		operationId: "listCountries",
		tags: ["Carriers"],
		summary: "Countries, each with its country bundles and how many carriers it has",
		middleware: [budget("base")],
		request: { query: z.object(pageQuery).strict() },
		responses: { ...json(countryPageSchema, "A page of countries, by ISO code."), ...ERRORS },
	}),
	async (c) =>
		c.json(
			await paged(
				c,
				c.req.valid("query"),
				STRING_KEY,
				(w) => countryList(c.var.db, w),
				(r) => r.iso,
				(r) => r,
			),
			200,
		),
);

carriers.openapi(
	createRoute({
		method: "get",
		path: "/countries/{iso}",
		operationId: "getCountry",
		tags: ["Carriers"],
		summary: "A country: its country bundles and carriers",
		middleware: [budget("base")],
		request: { params: z.object({ iso: isoParam }), query: NO_QUERY },
		responses: { ...json(countrySchema, "The country."), ...ERRORS },
	}),
	async (c) => {
		const { iso } = c.req.valid("param");
		const [country, listed] = await Promise.all([countryOf(c.var.db, iso), countryCarriers(c.var.db, iso)]);
		if (country === undefined) throw fail(404, `No country ${iso}.`);
		return c.json({ iso, sources: country.sources, carriers: listed }, 200);
	},
);
