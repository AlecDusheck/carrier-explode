import { error } from "@sveltejs/kit";
import { modemTabView } from "#lib/components/views.ts";

/** A tab the platform's modems do not have, or a path the tab does not take, is not a page. */
export const load = async ({ params, parent }): Promise<void> => {
	const view = modemTabView((await parent()).platform, params.tab);
	if (!view || (params.path && !view.path?.test(params.path))) error(404, `No ${params.tab} here.`);
};
