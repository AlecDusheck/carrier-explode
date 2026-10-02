import { error } from "@sveltejs/kit";
import { article } from "#lib/wiki.ts";

export function load({ params }) {
  const a = article(params.slug);
  if (!a) error(404, `No wiki article named ${params.slug}`);
  return { article: a, meta: { title: a.searchTitle, description: a.description } };
}
