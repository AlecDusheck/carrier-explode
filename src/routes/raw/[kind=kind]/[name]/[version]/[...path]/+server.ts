import { getRaw } from "$lib/server/data";
import { contentTypeOf } from "$lib/decode";
import { normalizeApplePng } from "$lib/decode";

/** One member of a bundle, as-is. Carrier logos are Apple CgBI PNGs, which no browser renders, so those are converted. */
export async function GET({ params, url }) {
  const { bytes } = await getRaw(params.kind, params.name, params.version, params.path);
  const body = normalizeApplePng(bytes) ?? bytes;
  const file = params.path.split("/").pop()!.replace(/"/g, "");
  return new Response(body as unknown as BodyInit, {
    headers: {
      "content-type": contentTypeOf(params.path),
      "content-disposition": `${url.searchParams.has("dl") ? "attachment" : "inline"}; filename="${file}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
