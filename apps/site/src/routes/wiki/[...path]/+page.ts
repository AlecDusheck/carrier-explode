import { error } from "@sveltejs/kit";
import { article } from "#lib/wiki.ts";

export function load({ params }) {
  const a = article(params.path);
  if (!a) error(404, `No wiki article at ${params.path}`);
  return { article: a, meta: { title: a.searchTitle, description: a.description } };
}
