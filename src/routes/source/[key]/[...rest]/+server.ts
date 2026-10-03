import { redirect } from "@sveltejs/kit";
import { parseRest, sourcePath } from "#lib/server/paths.ts";

/**
 * Any source by its key: `/source/ios:carrier:ATT_US[/<version>][/<tab>[/<path>]][?release=<id>]`.
 * Links that only know a key (scan results, a release's sources, the SIM table,
 * the wiki, v1 URLs) come through here to the page the source lives on.
 */
export async function GET({ params, url }) {
  redirect(307, (await sourcePath(params.key, parseRest(params.rest), url.searchParams.get("release"))));
}
