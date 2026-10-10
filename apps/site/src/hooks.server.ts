/** Every request: old URLs repaired, and the cache policy on the way out. */

import { env } from "cloudflare:workers";
import type { Handle } from "@sveltejs/kit/hooks";
import { applyPolicy } from "@carrier-explode/storage";
import { responsePolicy } from "#lib/server/cache-policy.ts";
import { isIndexed } from "#lib/server/catalog.ts";
import { getCountryCarriers, getList } from "#lib/server/lists.ts";
import { repair, type Held } from "#lib/server/legacy.ts";
import { releaseNamed } from "#lib/server/releases.ts";
import { article } from "#lib/wiki.ts";
import { sourceKey } from "@carrier-explode/schema/types";

const held: Held = {
	source: (ref) => isIndexed(sourceKey(ref)),
	countryFile: async (platform, iso) =>
		(await getList(platform, "country")).find((e) => e.cc?.toLowerCase() === iso)?.name ?? null,
	carriersIn: async (platform, iso) => (await getCountryCarriers(platform, iso)).length > 0,
	build: async (id) => (await releaseNamed("ios", id)) !== null,
	article: (path) => article(path) !== undefined,
};

/** Workers Assets serves every file it holds before the worker runs, so a file name reaching here is one it lacks. */
const STATIC_FILE = /\.(?:svg|png|ico|jpe?g|webp|gif|css|js|map|woff2?)$/;
const missingFile = ({ pathname }: URL): boolean =>
	STATIC_FILE.test(pathname) && !pathname.startsWith("/raw/");

export const handle: Handle = async ({ event, resolve }) => {
	const response = missingFile(event.url)
		? new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
		: await repair(event.request, env.LEGACY_REPAIR, held, () => resolve(event));
	const policy = await responsePolicy(event, response, env.CACHE_TTL);
	if (policy) applyPolicy(response.headers, policy);
	return response;
};
