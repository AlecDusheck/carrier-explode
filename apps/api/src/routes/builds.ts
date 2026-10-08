/** OS builds (an iOS build, a Pixel build, a Galaxy firmware): what each changed, and the modems it ships. */

import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
	changesOf,
	modemConfigsOf,
	modemsOf,
	releaseList,
	releaseOf,
	type ListedRelease,
	type ShownChange,
	type ShownEnd,
} from "@carrier-explode/db";
import {
	MAIN_LINE,
	isDeviceReleasePlatform,
	type ReleasePlatform,
	type SourceKey,
} from "@carrier-explode/schema/types";
import { fail, router, type ApiContext, type ApiEnv } from "../context.ts";
import { canonicalSearch, pageQuery, paged, SOURCE_KEY, STRING_KEY } from "../page.ts";
import {
	buildModemsSchema,
	buildPageSchema,
	buildSchema,
	changePageSchema,
	type BuildHeader,
	type ShippedModems,
} from "../shapes.ts";
import {
	buildParam,
	carrierParam,
	deviceParam,
	ERRORS,
	json,
	NO_QUERY,
	releasePlatformParam,
} from "./common.ts";

const onPlatform = z.object({ platform: releasePlatformParam });
const ofBuild = onPlatform.extend({ build: buildParam });

/** The API states a build's header alone; its sort key is the list's cursor. */
function header(r: ListedRelease): BuildHeader {
	const { id, version, released, devices, sourceCount } = r;
	const common = { id, version, released, devices: [...devices], sourceCount };
	switch (r.platform) {
		case "ios":
			return { ...common, platform: r.platform, label: r.label, prerelease: r.prerelease };
		case "android":
			return { ...common, platform: r.platform, patch: r.patch };
		case "samsung":
			return { ...common, platform: r.platform };
	}
}

async function releaseNamed(c: ApiContext, on: ReleasePlatform, id: string): Promise<ListedRelease> {
	const release = await releaseOf(c.var.db, on, id);
	if (!release) throw fail(404, `No ${on} build ${id}.`);
	return release;
}

/** The modems a build ships, for every device or only `device`'s. */
export async function shippedModems(
	c: ApiContext,
	platform: ReleasePlatform,
	build: string,
	device: string | null,
): Promise<ShippedModems> {
	const shipped = (await modemsOf(c.var.db, platform, build)).filter(
		(m) => device === null || m.devices.includes(device),
	);
	if (isDeviceReleasePlatform(platform)) {
		const modems = await Promise.all(
			shipped.map(async ({ name, family, familyName, devices }) => {
				const [first] = devices;
				if (first === undefined) throw new Error(`${build}: modem ${name} runs on no device`);
				return {
					name,
					family,
					familyName,
					devices,
					configs: (await modemConfigsOf(c.var.db, platform, build, first)).map((config) => ({
						label: config.label,
						name: config.name,
						sha: config.sha,
					})),
				};
			}),
		);
		return { platform, modems };
	}
	return {
		platform,
		modems: shipped.map(({ package: sha, name, family, familyName, devices }) => {
			if (sha === null) throw new Error(`${build}: iOS modem ${name} names no package`);
			return { name, family, familyName, devices, package: sha };
		}),
	};
}

/** The comparison of a change's two versions, as /v1/compare spells it. */
function compareUrl(c: ApiContext, source: SourceKey, from: ShownEnd, to: ShownEnd): string {
	const url = new URL("/v1/compare", c.req.url);
	const side = (name: string, end: ShownEnd): Array<[string, string]> => [
		[name, source],
		...(end.line === MAIN_LINE ? [] : [[`${name}_line`, end.line] satisfies [string, string]]),
		[`${name}_version`, end.slug],
	];
	url.search = canonicalSearch(new URLSearchParams([...side("a", from), ...side("b", to)]));
	return url.href;
}

const withCompare = (c: ApiContext) => (change: ShownChange) =>
	change.kind === "changed"
		? { ...change, compare: compareUrl(c, change.source, change.from, change.to) }
		: change;

export const builds: OpenAPIHono<ApiEnv> = router();

builds.openapi(
	createRoute({
		method: "get",
		path: "/{platform}/builds",
		operationId: "listBuilds",
		tags: ["Builds"],
		summary: "One platform's builds, newest first",
		request: {
			params: onPlatform,
			query: z
				.object({
					...pageQuery,
					version: z
						.string()
						.regex(/^[\w.]{1,20}$/)
						.optional()
						.openapi({
							description: "Only builds of this OS version, as the build states it.",
							example: "27.2",
						}),
					device: deviceParam.optional().openapi({ description: "Only builds that list this device." }),
				})
				.strict(),
		},
		responses: { ...json(buildPageSchema, "A page of builds."), ...ERRORS },
	}),
	async (c) => {
		const { platform } = c.req.valid("param");
		const { version, device, ...page } = c.req.valid("query");
		const filter = { version: version ?? null, device: device ?? null };
		return c.json(
			await paged(
				c,
				page,
				STRING_KEY,
				(w) => releaseList(c.var.db, platform, w, filter),
				(r) => r.sortKey,
				header,
			),
			200,
		);
	},
);

builds.openapi(
	createRoute({
		method: "get",
		path: "/{platform}/builds/{build}",
		operationId: "getBuild",
		tags: ["Builds"],
		summary: "A build: its version, devices and how many sources it carries",
		request: { params: ofBuild, query: NO_QUERY },
		responses: { ...json(buildSchema, "The build."), ...ERRORS },
	}),
	async (c) => {
		const { platform, build } = c.req.valid("param");
		return c.json(header(await releaseNamed(c, platform, build)), 200);
	},
);

builds.openapi(
	createRoute({
		method: "get",
		path: "/{platform}/builds/{build}/changes",
		operationId: "listBuildChanges",
		tags: ["Builds"],
		summary: "The sources a build added, removed or changed against the platform's build before it",
		request: {
			params: ofBuild,
			query: z
				.object({
					...pageQuery,
					carrier: carrierParam.optional().openapi({ description: "Only this carrier's sources." }),
				})
				.strict(),
		},
		responses: {
			...json(
				changePageSchema,
				"A page of changes, by source; a change links the comparison of its versions.",
			),
			...ERRORS,
		},
	}),
	async (c) => {
		const { platform, build } = c.req.valid("param");
		const { carrier, ...page } = c.req.valid("query");
		await releaseNamed(c, platform, build);
		return c.json(
			await paged(
				c,
				page,
				SOURCE_KEY,
				(w) => changesOf(c.var.db, platform, build, w, carrier ?? null),
				(r) => r.source,
				withCompare(c),
			),
			200,
		);
	},
);

builds.openapi(
	createRoute({
		method: "get",
		path: "/{platform}/builds/{build}/modems",
		operationId: "getBuildModems",
		tags: ["Builds"],
		summary:
			"The modems a build ships: iOS baseband firmware packages, or Pixel and Galaxy modem firmware and their carrier configurations",
		request: { params: ofBuild, query: NO_QUERY },
		responses: { ...json(buildModemsSchema, "The build's modems."), ...ERRORS },
	}),
	async (c) => {
		const { platform, build } = c.req.valid("param");
		await releaseNamed(c, platform, build);
		return c.json(await shippedModems(c, platform, build, null), 200);
	},
);
