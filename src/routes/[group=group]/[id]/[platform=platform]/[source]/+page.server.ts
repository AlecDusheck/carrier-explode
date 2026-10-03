import { redirect } from "@sveltejs/kit";
import { nativePath } from "#lib/server/paths.ts";

/** A source without a version is its head: the version phones on a release run. */
export const load = async ({ params, url }) => {
  redirect(307, await nativePath(params, { search: url.search }));
};
