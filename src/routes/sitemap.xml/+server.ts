import { basebandBuilds, getIndex } from "$lib/server/data";

/** The lists, one page per bundle, per iOS image and per modem package in each image. Versions, tabs and files hang off those. */
export async function GET({ url }) {
  const [idx, bb] = await Promise.all([getIndex(), basebandBuilds()]);
  const paths = [
    "/carriers", "/countries", "/watch", "/cell-broadcast", "/plmn", "/releases",
    ...(["carriers", "countries", "watch"] as const).flatMap((kind) =>
      idx[kind].map((e) => `/${kind}/${encodeURIComponent(e.name)}`)),
    ...idx.builds.map((b) => `/releases/${encodeURIComponent(b.build)}`),
    ...bb.flatMap((b) => b.families.map((f) => `/baseband/${encodeURIComponent(b.build)}/${encodeURIComponent(f)}`)),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `<url><loc>${url.origin}${p}</loc></url>`).join("\n")}
</urlset>`;
  return new Response(body, { headers: { "content-type": "application/xml" } });
}
