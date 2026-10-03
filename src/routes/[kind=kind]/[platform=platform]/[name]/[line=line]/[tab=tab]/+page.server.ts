import { redirect } from "@sveltejs/kit";
import { refOf, verOf } from "#lib/at.ts";
import { versionPath } from "#lib/schema/types.ts";
import { resolve } from "#lib/server/catalog.ts";

/** A tab without a version is the line head's: `/countries/ios/Germany/alerts`. */
export const load = async ({ params, url }) => {
  const r = await resolve(verOf(params));
  redirect(307, `${versionPath(refOf(params), r.entry.slug, r.line)}/${params.tab}${url.search}`);
};
