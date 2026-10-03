import { redirect } from "@sveltejs/kit";

/** The tab is now modem; old links keep working. */
export const load = ({ url }) => redirect(308, url.pathname.replace(/\/baseband$/, "/modem") + url.search);
