import { error } from "@sveltejs/kit";
import { tabView } from "#lib/components/views.ts";

/** A tab the platform does not have, or a file under a tab that takes none, is not a page. */
export const load = ({ params }) => {
  const view = tabView(params.platform, params.tab);
  if (!view || (params.path && !view.takesPath)) error(404, `No ${params.tab} tab here.`);
};
