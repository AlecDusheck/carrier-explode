import { redirect } from "@sveltejs/kit";

/** A country's alerts are a tab of its bundle. */
export const load = ({ params }) => redirect(308, `/countries/${encodeURIComponent(params.country)}/alerts`);
