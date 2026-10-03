import { redirect } from "@sveltejs/kit";

/** Each country's alerts are a tab of its bundle; the countries list is where to pick one. */
export const load = () => redirect(308, "/countries");
