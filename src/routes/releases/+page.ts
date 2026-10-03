import { redirect } from "@sveltejs/kit";

/** Releases and baseband are one page per iOS build now. */
export const load = () => redirect(308, "/builds");
