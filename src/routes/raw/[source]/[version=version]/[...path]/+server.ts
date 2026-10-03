import { error } from "@sveltejs/kit";
import { contentTypeOf, normalizeApplePng } from "#lib/decode/index.ts";
import { getRaw } from "#lib/server/ios.ts";

/**
 * The images and audio the iOS pages embed. Every other file is only shown decoded, never handed out as-is.
 * Carrier logos are Apple CgBI PNGs, which no browser renders, so those are converted.
 */
export async function GET({ params }) {
  const type = contentTypeOf(params.path);
  if (!type.startsWith("image/") && !type.startsWith("audio/")) error(404, "Not found");
  const bytes = await getRaw(params.source, params.version, params.path);
  return new Response(normalizeApplePng(bytes) ?? bytes, {
    headers: { "content-type": type, "x-content-type-options": "nosniff" },
  });
}
