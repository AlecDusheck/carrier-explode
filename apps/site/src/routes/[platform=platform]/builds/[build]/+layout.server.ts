import { mustRelease } from "#lib/server/releases.ts";

/** A build of another platform, or none, is not a page. */
export const load = async ({ params, parent }): Promise<void> => {
	await mustRelease((await parent()).platform, params.build);
};
