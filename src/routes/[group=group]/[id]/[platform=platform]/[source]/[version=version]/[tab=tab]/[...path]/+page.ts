import { error, redirect } from "@sveltejs/kit";
import { tabAlias, tabView } from "#lib/components/views.ts";

/** Old tab names move to their new ones; a tab the platform has not got, or a path under a tab that takes none, is not a page. */
export const load = ({ params, url }) => {
  const alias = tabAlias(params.platform, params.tab);
  if (alias) redirect(308, url.pathname.replace(new RegExp(`/${params.tab}(/|$)`), `/${alias}$1`) + url.search);
  const view = tabView(params.platform, params.tab);
  if (!view || (params.path && !view.takesPath)) error(404, `No ${params.tab} tab here.`);
};
