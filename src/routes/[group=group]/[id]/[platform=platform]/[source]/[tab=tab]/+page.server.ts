import { redirect } from "@sveltejs/kit";
import { nativePath } from "#lib/server/paths.ts";

/** A tab without a version is the head version's: `/countries/de/ios/Germany/alerts`. */
export const load = async ({ params, url }) => {
  redirect(307, await nativePath(params, { tab: params.tab, search: url.search }));
};
