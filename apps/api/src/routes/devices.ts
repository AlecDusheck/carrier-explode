/** iPhones, Pixels and Galaxies: each carrier's feature states on one, and the modems its builds ship. */

import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
	deviceList,
	deviceOf,
	releaseList,
	releaseOf,
	statesOn,
	type ListedRelease,
	type ShownDevice,
} from "@carrier-explode/db";
import { RELEASE_PLATFORMS } from "@carrier-explode/schema/types";
import { fail, router, type ApiContext, type ApiEnv } from "../context.ts";
import { pageQuery, paged, SOURCE_KEY, STRING_KEY, windowOf } from "../page.ts";
import { deviceDetailSchema, deviceFeaturesSchema, deviceModemsSchema, devicePageSchema } from "../shapes.ts";
import { shippedModems } from "./builds.ts";
import {
	buildParam,
	deviceParam,
	ERRORS,
	json,
	NO_QUERY,
	releasePlatformParam,
	searchParam,
} from "./common.ts";

const ofDevice = z.object({ code: deviceParam });

export async function deviceNamed(c: ApiContext, code: string): Promise<ShownDevice> {
	const device = await deviceOf(c.var.db, code);
	if (!device) throw fail(404, `No device ${code}: /v1/devices?q= finds one by name.`);
	return device;
}

export const deviceRef = ({
	code,
	name,
	platform,
}: ShownDevice): Pick<ShownDevice, "code" | "name" | "platform"> => ({
	code,
	name,
	platform,
});

const contains = (text: string, q: string): boolean => text.toLowerCase().includes(q.toLowerCase());

/** The newest build that lists the device. */
async function newestBuild(c: ApiContext, device: ShownDevice): Promise<ListedRelease | undefined> {
	const [newest] = await releaseList(
		c.var.db,
		device.platform,
		{ after: null, take: 1 },
		{ version: null, device: device.code },
	);
	return newest;
}

/** The build named, which must list the device, else its newest. */
async function buildOf(c: ApiContext, device: ShownDevice, named: string | undefined): Promise<string> {
	const release =
		named === undefined ? await newestBuild(c, device) : await releaseOf(c.var.db, device.platform, named);
	if (!release?.devices.includes(device.code))
		throw fail(404, `No ${device.platform} build ${named ?? ""} of ${device.code} is indexed.`);
	return release.id;
}

export const devices: OpenAPIHono<ApiEnv> = router();

devices.openapi(
	createRoute({
		method: "get",
		path: "/devices",
		operationId: "listDevices",
		tags: ["Devices"],
		summary: "Every phone a feed lists: iPhones, then Pixels, then Galaxies, each newest first",
		request: {
			query: z
				.object({
					...pageQuery,
					platform: releasePlatformParam.optional(),
					q: searchParam
						.optional()
						.openapi({ description: "Part of its name or code, in any case.", example: "Pixel" }),
				})
				.strict(),
		},
		responses: { ...json(devicePageSchema, "A page of devices."), ...ERRORS },
	}),
	async (c) => {
		const { platform, q, ...page } = c.req.valid("query");
		const lists = await Promise.all(
			(platform === undefined ? RELEASE_PLATFORMS : [platform]).map((p) => deviceList(c.var.db, p)),
		);
		const shown = lists.flat().filter((d) => q === undefined || contains(d.name, q) || contains(d.code, q));
		return c.json(
			await paged(
				c,
				page,
				STRING_KEY,
				(w) => Promise.resolve(windowOf(shown, (d) => d.code, w)),
				(d) => d.code,
				(d) => d,
			),
			200,
		);
	},
);

devices.openapi(
	createRoute({
		method: "get",
		path: "/devices/{code}",
		operationId: "getDevice",
		tags: ["Devices"],
		summary: "A device, with the newest build that lists it",
		request: { params: ofDevice, query: NO_QUERY },
		responses: { ...json(deviceDetailSchema, "The device."), ...ERRORS },
	}),
	async (c) => {
		const device = await deviceNamed(c, c.req.valid("param").code);
		const newest = await newestBuild(c, device);
		return c.json(
			{
				...device,
				build:
					newest === undefined ? null : { id: newest.id, version: newest.version, released: newest.released },
			},
			200,
		);
	},
);

devices.openapi(
	createRoute({
		method: "get",
		path: "/devices/{code}/features",
		operationId: "listDeviceFeatures",
		tags: ["Devices"],
		summary:
			"Each carrier source's feature states on one phone: on, available (a switch, or per plan), or no",
		request: { params: ofDevice, query: z.object(pageQuery).strict() },
		responses: {
			...json(
				deviceFeaturesSchema,
				"A page of carrier sources, by key; a source that ships nothing for the phone is absent.",
			),
			...ERRORS,
		},
	}),
	async (c) => {
		const { code } = await deviceNamed(c, c.req.valid("param").code);
		return c.json(
			await paged(
				c,
				c.req.valid("query"),
				SOURCE_KEY,
				(w) => statesOn(c.var.db, code, w),
				(r) => r.source,
				(r) => r,
			),
			200,
		);
	},
);

devices.openapi(
	createRoute({
		method: "get",
		path: "/devices/{code}/modems",
		operationId: "getDeviceModems",
		tags: ["Devices"],
		summary:
			"The modems a device's build ships for it: an iPhone's baseband packages, a Pixel's or Galaxy's firmware and its carrier configurations",
		request: {
			params: ofDevice,
			query: z
				.object({
					build: buildParam.optional().openapi({ description: "Default: the newest build that lists it." }),
				})
				.strict(),
		},
		responses: { ...json(deviceModemsSchema, "The modems."), ...ERRORS },
	}),
	async (c) => {
		const device = await deviceNamed(c, c.req.valid("param").code);
		const build = await buildOf(c, device, c.req.valid("query").build);
		return c.json(
			{ device: device.code, build, ...(await shippedModems(c, device.platform, build, device.code)) },
			200,
		);
	},
);
