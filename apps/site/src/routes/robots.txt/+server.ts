/** Bundle pages are the content; /raw serves bundle members and /compare is a tool whose query strings are endless, so neither is worth a crawl budget. */
export function GET({ url }) {
	const body = `User-agent: *
Disallow: /raw/
Disallow: /compare
Disallow: /internal/

Sitemap: ${url.origin}/sitemap.xml
`;
	return new Response(body, { headers: { "content-type": "text/plain" } });
}
