import { verOf } from "#lib/at.ts";
import { canonicalPath, resolve } from "#lib/server/catalog.ts";

/** Several Pixels can carry one file; every device's URL serves it, and the canonical link names one. */
export const load = async ({ params }) => ({ canonical: canonicalPath(await resolve(verOf(params))) });
