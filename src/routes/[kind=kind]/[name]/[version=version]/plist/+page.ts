import { redirect } from "@sveltejs/kit";

/** The tab is now settings; old links keep working. */
export const load = ({ url }) => redirect(308, url.pathname.replace(/\/plist$/, "/settings") + url.search);
