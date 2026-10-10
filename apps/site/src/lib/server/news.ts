/** The home page's News box, from wrangler.jsonc vars.NEWS, so news changes with a config deploy. */

import { env } from "cloudflare:workers";
import * as v from "valibot";

const newsItem = v.pipe(
	v.object({
		text: v.pipe(v.string(), v.nonEmpty()),
		/** A phrase of `text` and where it leads. */
		link: v.exactOptional(
			v.object({
				text: v.pipe(v.string(), v.nonEmpty()),
				href: v.pipe(v.string(), v.url(), v.startsWith("https://")),
			}),
		),
	}),
	v.check(
		(n) => n.link === undefined || n.text.includes(n.link.text),
		"a link's text is not in its item's text",
	),
);

export type NewsItem = v.InferOutput<typeof newsItem>;

/** Read per request: the build imports this module where Cloudflare's env does not exist. */
export const news = (): readonly NewsItem[] => v.parse(v.array(newsItem), env.NEWS);
