import { redirect } from "@sveltejs/kit";

export const load = ({ params }) => redirect(308, `/builds/${encodeURIComponent(params.build)}`);
