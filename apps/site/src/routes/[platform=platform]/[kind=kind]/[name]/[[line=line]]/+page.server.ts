import { verOf } from "#lib/at.ts";
import { resolvePage } from "#lib/server/catalog.ts";

/** A line the index lacks is a stale link: the source's page stands in. */
export const load = async ({ params }): Promise<void> => {
	await resolvePage(verOf(params));
};
