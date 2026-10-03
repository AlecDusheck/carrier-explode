import { redirect } from "@sveltejs/kit";

/** The MCC-MNC lookup is the search on the Carriers page; `?q=` carries over. */
export const load = ({ url }) => redirect(308, "/carriers" + url.search);
