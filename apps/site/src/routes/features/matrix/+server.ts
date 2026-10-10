import { redirect } from "@sveltejs/kit";
import { link } from "#lib/format.ts";

// The matrix was first shared at this address; its requirements stay in the query.
export const GET = ({ url }): never => redirect(308, link("/features") + url.search);
