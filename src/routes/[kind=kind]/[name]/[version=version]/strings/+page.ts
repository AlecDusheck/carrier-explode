import { redirect } from "@sveltejs/kit";

/** Localised text is a section of Settings now; its file picker is `strings` there. */
export const load = ({ url }) => {
  const q = new URLSearchParams(url.search);
  const file = q.get("file");
  q.delete("file");
  if (file) q.set("strings", file);
  const search = q.size ? "?" + q : "";
  redirect(308, url.pathname.replace(/\/strings$/, "/settings") + search + "#text");
};
