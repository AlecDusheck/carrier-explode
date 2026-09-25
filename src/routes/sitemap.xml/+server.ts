import { basebandBuilds, getIndex } from "$lib/server/data";

/** The lists, one page per bundle and one per iOS image and baseband package. Versions, tabs and files hang off those. */
export async function GET({ url }) {
  const [idx, bb] = await Promise.all([getIndex(), basebandBuilds()]);
  const paths = [
    "/carriers", "/countries", "/watch", "/cell-broadcast", "/plmn", "/releases",
    ...(["carriers", "countries", "watch"] as const).flatMap((kind) =>
      idx[kind].map((e) => `/${kind}/${encodeURIComponent(e.name)}`)),
    ...idx.builds.map((b) => `/releases/${encodeURIComponent(b.build)}`),
    ...bb.filter((b) => b.has).map((b) => `/baseband/${encodeURIComponent(b.build)}`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `<url><loc>${url.origin}${p}</loc></url>`).join("\n")}
</urlset>`;
  return new Response(body, { headers: { "content-type": "application/xml" } });
}
