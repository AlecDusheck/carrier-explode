import { redirect } from "@sveltejs/kit";
import { MATRIX_PARAMS } from "#lib/feature-matrix.ts";
import { link } from "#lib/format.ts";
import { news, type NewsItem } from "#lib/server/news.ts";

// The feature matrix was the home page, and its links keep their requirements in the query.
export const load = ({ url }): { readonly news: readonly NewsItem[] } => {
	if (MATRIX_PARAMS.some((p) => url.searchParams.has(p))) redirect(308, link("/features") + url.search);
	return { news: news() };
};
