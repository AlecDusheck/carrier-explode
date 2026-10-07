import { error } from "@sveltejs/kit";
import { getRuleSources } from "#lib/api/sources.remote.ts";

/** The carrier list's page of the sources named only by a SIM rule, on a platform that has some. */
export const load = async ({ params }): Promise<void> => {
	if (params.kind !== "carriers" || !(await getRuleSources({ platform: params.platform, iso: null })).length)
		error(404, "Not found");
};
