import { redirect } from "@sveltejs/kit";
import { getHead } from "#lib/server/data.ts";

/** A tab without a version is the current version's: `/countries/Germany/alerts`. */
export const load = async ({ params, url }) => {
  const { slug } = await getHead(params.kind, params.name);
  redirect(307, `/${params.kind}/${encodeURIComponent(params.name)}/${encodeURIComponent(slug)}/${params.tab}${url.search}`);
};
