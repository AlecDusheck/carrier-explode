import { news, type NewsItem } from "#lib/server/news.ts";

export const load = (): { readonly news: readonly NewsItem[] } => ({ news: news() });
