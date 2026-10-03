import { redirect } from "@sveltejs/kit";

/** The tab is now files; old links keep working. */
export const load = ({ url }) => redirect(308, url.pathname.replace(/\/assets$/, "/files") + url.search);
