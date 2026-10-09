import { redirect } from "@sveltejs/kit";
import { link } from "#lib/format.ts";

// The matrix was first shared at this address; it is the home page now.
export const GET = ({ url }): never => redirect(308, link("/") + url.search);
