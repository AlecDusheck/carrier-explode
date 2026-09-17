import { getRaw } from "$lib/server/data";

export async function GET({ params }) {
  const { bytes } = await getRaw(params.kind, params.name, params.version);
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${params.name}_${params.version}.ipcc"`,
      "cache-control": "public, max-age=2592000, immutable",
    },
  });
}
