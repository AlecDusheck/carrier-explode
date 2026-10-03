import { error } from "@sveltejs/kit";
import { getRaw } from "#lib/server/data.ts";
import { contentTypeOf } from "#lib/decode/index.ts";
import { normalizeApplePng } from "#lib/decode/index.ts";

/**
 * The images and audio the pages embed. Every other file is only shown decoded, never handed out as-is.
 * Carrier logos are Apple CgBI PNGs, which no browser renders, so those are converted.
 */
export async function GET({ params }) {
  const type = contentTypeOf(params.path);
  if (!type.startsWith("image/") && !type.startsWith("audio/")) error(404, "Not found");
  const { bytes } = await getRaw(params.kind, params.name, params.version, params.path);
  const body = normalizeApplePng(bytes) ?? bytes;
  return new Response(body as unknown as BodyInit, {
    headers: { "content-type": type, "x-content-type-options": "nosniff" },
  });
}
