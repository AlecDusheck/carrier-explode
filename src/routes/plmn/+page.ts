import { redirect } from "@sveltejs/kit";

/** The MCC-MNC lookup is /sim now; `?q=` carries over. */
export const load = ({ url }) => redirect(308, "/sim" + url.search);
