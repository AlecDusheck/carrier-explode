import { env } from "cloudflare:workers";
import { pageNames } from "#lib/server/page-names.ts";

export const load = async ({ params }) => ({ names: await pageNames(params), apiOrigin: env.API_ORIGIN });
