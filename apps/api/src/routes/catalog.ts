/** What the API covers, which never changes between deploys: its collections, the platforms and the concepts profiles read. */

import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
	CONCEPTS,
	decoderFamily,
	FAMILY_KINDS,
	GROUP_NAMES,
	isReleasePlatform,
	KIND_SEGMENT,
	PLATFORMS,
} from "@carrier-explode/schema";
import { router, type ApiEnv } from "../context.ts";
import { budget } from "../rate.ts";
import {
	conceptsSchema,
	indexSchema,
	platformsSchema,
	type ConceptInfo,
	type PlatformInfo,
} from "../shapes.ts";
import { ERRORS, json, NO_QUERY } from "./common.ts";

const PLATFORM_INFO: readonly PlatformInfo[] = PLATFORMS.map((platform) => {
	const family = decoderFamily(platform);
	return {
		platform,
		family,
		kinds: FAMILY_KINDS[family].map((k) => KIND_SEGMENT[k]),
		builds: isReleasePlatform(platform),
	};
});

// oxlint-disable-next-line oxc/no-map-spread -- the concepts are schema's shared registry; assigning to them would change it.
const CONCEPT_INFO: readonly ConceptInfo[] = CONCEPTS.map((c) => ({ ...c, groupName: GROUP_NAMES[c.group] }));

/** Each collection, with an example an agent can follow. */
const RESOURCES = [
	["/v1/platforms", "/v1/platforms", "Platforms, the kinds of source each ships, and whether it has builds"],
	["/v1/concepts", "/v1/concepts", "Every concept a profile reads; features are the `state` ones"],
	["/v1/carriers", "/v1/carriers?q=verizon", "Carriers, linked across platforms by the SIMs they claim"],
	[
		"/v1/carriers/{id}/features",
		"/v1/carriers/ATT_US/features?feature=volte",
		"Its feature states on each platform's newest phone",
	],
	[
		"/v1/carriers/{id}/profiles",
		"/v1/carriers/ATT_US/profiles?fields=apns",
		"Each of its sources' head, decoded",
	],
	[
		"/v1/carriers/{id}/modems",
		"/v1/carriers/ATT_US/modems",
		"Pixel and Galaxy modem configurations its SIMs select",
	],
	["/v1/countries", "/v1/countries/jp", "Countries: their carriers and country bundles"],
	[
		"/v1/features/{feature}",
		"/v1/features/5g-standalone?country=jp",
		"Every carrier's state of one feature, per phone",
	],
	["/v1/devices", "/v1/devices?platform=samsung", "iPhones, Pixels and Galaxies, newest first"],
	["/v1/devices/{code}/modems", "/v1/devices/SM-S948U/modems", "The modems a device's newest build ships"],
	["/v1/sims", "/v1/sims?gid1=6D38&mccmnc=310260", "Every source a SIM selects"],
	[
		"/v1/compare",
		"/v1/compare?a=ios:carrier:ATT_US&b=android:carrier:att_us",
		"Two versions: concepts, APNs, settings",
	],
	["/v1/{platform}/{kind}", "/v1/samsung/carriers", "One platform's sources of one kind"],
	[
		"/v1/{platform}/{kind}/{name}/versions/{version}",
		"/v1/ios/carriers/ATT_US/versions/latest",
		"A version, decoded",
	],
	["/v1/{platform}/builds", "/v1/ios/builds?version=27.2", "Builds, newest first, and what each changed"],
	["/v1/modem-configs/{sha}", "/v1/modem-configs/{sha}", "A modem configuration, decoded"],
] as const;

export const catalog: OpenAPIHono<ApiEnv> = router();

catalog.openapi(
	createRoute({
		method: "get",
		path: "/",
		operationId: "getIndex",
		tags: ["Catalog"],
		summary: "Every collection, with an example request",
		middleware: [budget("base")],
		request: { query: NO_QUERY },
		responses: { ...json(indexSchema, "The index."), ...ERRORS },
	}),
	(c) => {
		const origin = new URL(c.req.url).origin;
		return c.json(
			{
				openapi: `${origin}/openapi.json`,
				docs: `${origin}/`,
				resources: RESOURCES.map(([path, example, about]) => ({
					path,
					example: `${origin}${example}`,
					about,
				})),
			},
			200,
		);
	},
);

catalog.openapi(
	createRoute({
		method: "get",
		path: "/platforms",
		operationId: "listPlatforms",
		tags: ["Catalog"],
		summary: "Every platform, the kinds of source it ships, and whether it has builds",
		middleware: [budget("base")],
		request: { query: NO_QUERY },
		responses: { ...json(platformsSchema, "The platforms."), ...ERRORS },
	}),
	(c) => c.json(PLATFORM_INFO, 200),
);

catalog.openapi(
	createRoute({
		method: "get",
		path: "/concepts",
		operationId: "listConcepts",
		tags: ["Catalog"],
		summary: "Every concept a profile reads: its group, type and unit; the `state` ones are features",
		middleware: [budget("base")],
		request: { query: NO_QUERY },
		responses: { ...json(conceptsSchema, "The concepts, in display order."), ...ERRORS },
	}),
	(c) => c.json(CONCEPT_INFO, 200),
);
