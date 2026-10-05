import { error } from "@sveltejs/kit";
import { contentTypeOf, normalizeApplePng } from "@carrier-explode/decode-ios";
import { verOf } from "#lib/at.ts";
import { getRaw } from "#lib/server/apple/bundle.ts";

/**
 * The images and audio Apple bundle pages embed, under the version's own path; every other file is only shown decoded.
 * Carrier logos are Apple CgBI PNGs, which no browser renders, so those are converted.
 */
export async function GET({ params }) {
  const type = contentTypeOf(params.path);
  if (!type.startsWith("image/") && !type.startsWith("audio/")) error(404, "Not found");
  const bytes = await getRaw(verOf(params), params.path);
  // A copy: Response takes only ArrayBuffer-backed bytes.
  return new Response((normalizeApplePng(bytes) ?? bytes).slice(), { headers: { "content-type": type, "x-content-type-options": "nosniff" } });
}
