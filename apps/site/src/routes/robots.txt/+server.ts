/** Bundle pages are the content; /raw, /compare and a page's view parameters (a version pair, a filter, a search, a page offset) are endless, so none is worth a crawl budget. */
export function GET({ url }) {
	const body = `User-agent: *
Disallow: /raw/
Disallow: /compare
Disallow: /internal/
Disallow: /*?*against=
Disallow: /*?*filter=
Disallow: /*?*q=
Disallow: /*?*from=
Disallow: /*?*section=
Disallow: /*?*copy=
Disallow: /*?*show=

Sitemap: ${url.origin}/sitemap.xml
`;
	return new Response(body, { headers: { "content-type": "text/plain" } });
}
