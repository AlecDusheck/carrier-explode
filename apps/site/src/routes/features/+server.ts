import { redirect } from "@sveltejs/kit";
import { link } from "#lib/format.ts";

// The matrix is the home page; its requirements stay in the query.
export const GET = ({ url }): never => redirect(308, link("/") + url.search);
