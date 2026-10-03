/**
 * The v1 URLs (/carriers/<BundleName>/..., /watch/..., /countries/<Name>/...),
 * which named an iOS bundle where v2 names a carrier slug or a country code.
 * Pure, so the hook can call it on every request without touching R2: only the
 * source key is worked out here, and /source finds its page.
 */

import { sourceKey, type SourceRef } from "#lib/schema/types.ts";

/** A slug as carrier slugs are written: what a v1 bundle name never is (it has capitals or underscores). */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A path segment decoded, or null when its escapes are malformed: then it is no v1 URL either. */
function decodeSegment(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Where a v1 URL went, or null when the path is not one. */
export function legacyPath(pathname: string): string | null {
  // The Watch list was its own page; Watch bundles are members of their carriers now.
  if (pathname === "/watch") return "/carriers";
  const m = /^\/(carriers|countries|watch)\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!m) return null;
  const [, kind, name = "", rest = ""] = m;
  const decoded = decodeSegment(name);
  if (decoded === null) return null;
  if (kind === "carriers" && SLUG.test(decoded)) return null;
  if (kind === "countries" && /^[a-z]{2}$/.test(decoded)) return null;
  const ref: SourceRef =
    kind === "watch" ? { platform: "ios", kind: "carrier", name: decoded, family: "Watch" }
    : kind === "countries" ? { platform: "ios", kind: "country", name: decoded }
    : { platform: "ios", kind: "carrier", name: decoded };
  return `/source/${encodeURIComponent(sourceKey(ref))}${rest}`;
}
