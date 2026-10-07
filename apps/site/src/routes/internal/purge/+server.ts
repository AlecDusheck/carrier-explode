import { error } from "@sveltejs/kit";
import { cache, env } from "cloudflare:workers";
import { purgeCache, purgeRefusal } from "@carrier-explode/storage";

/** Drops cached pages so new settings show up without waiting out their TTL. Called by the extractor once an ingest lands. */
export async function POST({ request }) {
	const refused = purgeRefusal(request.headers.get("authorization"), env.PURGE_TOKEN);
	if (refused !== null) error(401, refused);
	const failure = await purgeCache(cache);
	if (failure !== null) error(502, failure);
	return new Response(null, { status: 204 });
}
