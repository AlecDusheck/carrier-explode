import { redirect } from "@sveltejs/kit";
import { listPath } from "@carrier-explode/schema/types";
import { PLATFORM_ORDER } from "#lib/platforms.ts";

export const load = (): never => redirect(307, listPath(PLATFORM_ORDER[0], "carrier"));
