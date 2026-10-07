import { error, redirect } from "@sveltejs/kit";
import { modemPath } from "@carrier-explode/schema/types";
import { getBuildModems } from "#lib/server/builds.ts";

/** A modem is named by its id; naming a phone it serves leads to it. */
export const load = async ({ params, parent, url }): Promise<void> => {
	const { platform } = await parent();
	const modems = await getBuildModems(platform, params.build);
	if (modems.some((m) => m.id === params.modem)) return;
	const serving = modems.find((m) => m.devices.some((d) => d.code === params.modem));
	if (!serving) error(404, `${params.build} has no modem ${params.modem}.`);
	redirect(307, modemPath(platform, params.build, serving.id) + url.search);
};
