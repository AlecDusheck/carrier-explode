import { redirect } from "@sveltejs/kit";

/** The cross-country alert views are on the Countries page; `?view=` carries over. */
export const load = ({ url }) => redirect(308, "/countries" + url.search);
