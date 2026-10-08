/** One feature across every carrier: its state per carrier source on each platform's newest phone, or on the phone named. */

import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { featureStates, SCANNED_STATES, statedDevices, type ShownDevice } from "@carrier-explode/db";
import { FEATURE_SLUGS } from "@carrier-explode/schema";
import { RELEASE_PLATFORMS } from "@carrier-explode/schema/types";
import { fail, router, type ApiContext, type ApiEnv } from "../context.ts";
import { pageQuery, paged, SOURCE_KEY } from "../page.ts";
import { featureStatesSchema } from "../shapes.ts";
import { carrierRef } from "../versions.ts";
import { deviceParam, ERRORS, isoParam, json, releasePlatformParam } from "./common.ts";
import { deviceNamed, deviceRef } from "./devices.ts";

/** The phones a scan reads: the one named, else the newest that reads states on each platform asked for. */
export async function statePhones(
	c: ApiContext,
	device: string | undefined,
	platform: ShownDevice["platform"] | undefined,
): Promise<readonly ShownDevice[]> {
	if (device !== undefined) {
		const named = await deviceNamed(c, device);
		if (platform !== undefined && named.platform !== platform)
			throw fail(400, `${device} is a ${named.platform} device, not ${platform}.`);
		return [named];
	}
	const newest = await Promise.all(
		(platform === undefined ? RELEASE_PLATFORMS : [platform]).map((p) => statedDevices(c.var.db, p)),
	);
	return newest.flatMap((phones) => phones.slice(0, 1));
}

export const features: OpenAPIHono<ApiEnv> = router().openapi(
	createRoute({
		method: "get",
		path: "/features/{feature}",
		operationId: "listFeatureStates",
		tags: ["Features"],
		summary:
			"Every carrier source's state of one feature, on each platform's newest phone or on the phone named",
		request: {
			params: z.object({
				feature: z
					.enum(FEATURE_SLUGS)
					.openapi({ description: "A feature: a `state` concept's id.", example: "5g-standalone" }),
			}),
			query: z
				.object({
					...pageQuery,
					device: deviceParam.optional().openapi({ description: "The phone to read states on." }),
					platform: releasePlatformParam
						.optional()
						.openapi({ description: "Only this platform's newest phone." }),
					country: isoParam
						.optional()
						.openapi({ description: "Only sources its head or its carrier places in this country." }),
					state: z.enum(SCANNED_STATES).optional().openapi({
						description:
							"Only this state; `unset`: the phone reads the source, and nothing in it or under it decides.",
					}),
				})
				.strict(),
		},
		responses: {
			...json(
				featureStatesSchema,
				"A page of carrier sources, by key; a source that ships nothing for the phones is absent.",
			),
			...ERRORS,
		},
	}),
	async (c) => {
		const { feature } = c.req.valid("param");
		const { device, platform, country, state, ...page } = c.req.valid("query");
		const phones = await statePhones(c, device, platform);
		const filter = {
			feature,
			devices: phones.map((p) => p.code),
			country: country ?? null,
			state: state ?? null,
		};
		const states = await paged(
			c,
			page,
			SOURCE_KEY,
			(w) => featureStates(c.var.db, filter, w),
			(r) => r.source,
			(r) => ({
				source: r.source,
				carrier: carrierRef(r),
				device: r.device,
				state: r.state,
				defaulted: r.defaulted,
			}),
		);
		return c.json({ feature, devices: phones.map(deviceRef), ...states }, 200);
	},
);
