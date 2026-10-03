/**
 * Where a source's pages are, worked out on the server: the head version of a
 * native view, and a source key anywhere on the site (/source).
 */

import { error } from "@sveltejs/kit";
import { parseSourceKey, sourceKey, type Platform, type SourceRef } from "#lib/schema/types.ts";
import { refOf, segmentOf } from "#lib/places.ts";
import type { Group, Place } from "#lib/types.ts";
import { placeOf, resolve } from "./catalog";

const seg = encodeURIComponent;
const segs = (path: string): string => path.split("/").map(seg).join("/");

/** A native view's path. Unlike format.ts's links, no base path: these feed redirects. */
function pathOf(place: Place, ref: SourceRef, version: string, tab?: string, path?: string): string {
  const base = `/${place.group}/${seg(place.id)}/${ref.platform}/${seg(segmentOf(place.group, ref))}/${seg(version)}`;
  return base + (tab ? `/${tab}` : "") + (tab && path ? `/${segs(path)}` : "");
}

/** A native view at the head version (or at `version`), from route params. */
export async function nativePath(
  params: { group: Group; id: string; platform: Platform; source: string },
  opts: { version?: string; tab?: string; search?: string } = {},
): Promise<string> {
  const ref = refOf(params.group, params.platform, params.source);
  const { entry } = await resolve(sourceKey(ref), opts.version);
  return pathOf({ group: params.group, id: params.id }, ref, entry.slug, opts.tab) + (opts.search ?? "");
}

/** A version slug, a tab, and a file path under the tab, as the rest of a /source or v1 URL spells them. */
export interface Rest {
  readonly version?: string | undefined;
  readonly tab?: string | undefined;
  readonly path?: string | undefined;
}

const VERSION = /^(ota|ios|android)-./;

/** `[version][/tab[/path...]]`, where a first segment that is not a version is a tab of the head version. */
export function parseRest(rest: string): Rest {
  const parts = rest.split("/").filter(Boolean);
  const version = parts[0] !== undefined && VERSION.test(parts[0]) ? parts.shift() : undefined;
  const tab = parts.shift();
  return { version, tab, path: parts.length ? parts.join("/") : undefined };
}

/** The page for a source key: its native view at a version (or the one a release carries), on a tab. */
export async function sourcePath(key: string, rest: Rest, release?: string | null): Promise<string> {
  const ref = parseSourceKey(key);
  if (!ref) error(400, `Not a source key: ${key}`);
  const [place, r] = await Promise.all([placeOf(key), resolve(key, rest.version)]);
  if (!place) error(404, `${key} is on no carrier or country page yet.`);
  const inRelease = release ? r.timeline.find((e) => e.releases.includes(release)) : undefined;
  return pathOf(place, ref, (inRelease ?? r.entry).slug, rest.tab, rest.path);
}
