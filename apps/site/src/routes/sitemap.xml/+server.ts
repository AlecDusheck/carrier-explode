import {
	buildPath,
	buildsPath,
	FEATURE_SLUGS,
	listPath,
	modemPath,
	RELEASE_PLATFORMS,
	sourceOf,
	sourcePath,
} from "@carrier-explode/schema";
import { getBuilds, listedModems } from "#lib/server/builds.ts";
import { allSourceKeys, listPlatforms } from "#lib/server/lists.ts";
import { ARTICLES } from "#lib/wiki.ts";

/** The lists (one per platform), one page per source, per build and per modem in each build. Versions, tabs and files hang off those. */
export async function GET({ url }) {
	const [lists, keys, releases] = await Promise.all([listPlatforms(), allSourceKeys(), getBuilds()]);
	const paths = [
		"/features",
		...FEATURE_SLUGS.map((f) => `/features/${f}`),
		"/compare",
		"/wiki",
		...ARTICLES.map((a) => `/wiki/${a.path}`),
		...[...lists].flatMap(([kind, platforms]) => [...platforms].map((p) => listPath(p, kind))),
		...keys.map((k) => sourcePath(sourceOf(k))),
		...RELEASE_PLATFORMS.map(buildsPath),
		...releases.map((r) => buildPath(r.platform, r.id)),
		...releases.flatMap((r) => listedModems(r).map((m) => modemPath(r.platform, r.id, m))),
	];
	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `<url><loc>${url.origin}${p}</loc></url>`).join("\n")}
</urlset>`;
	return new Response(body, { headers: { "content-type": "application/xml" } });
}
