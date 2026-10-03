/**
 * From a page URL to a source. Remote queries are asked about a page and a
 * version (`{ kind: "carriers", name: "ATT_US", slug: "android-cp3a.260905.009-tokay" }`);
 * the version's platform says which of the page's lines it is on.
 */

import { error } from "@sveltejs/kit";
import type { Platform } from "#lib/schema/types.ts";
import type { Kind } from "#lib/types.ts";
import { lineOf, pageOf, type Page } from "./catalog";

export interface SourceAt {
  readonly page: Page;
  readonly platform: Platform;
  readonly source: string;
  /** Absent: the head. */
  readonly slug?: string | undefined;
}

export async function sourceAt(kind: Kind, name: string, slug?: string): Promise<SourceAt> {
  const page = await pageOf(kind, name);
  return { page, ...lineOf(page, slug), slug };
}

/** The same, for a query that only one platform answers. */
export async function onPlatform(platform: Platform, kind: Kind, name: string, slug?: string): Promise<SourceAt> {
  const at = await sourceAt(kind, name, slug);
  if (at.platform !== platform) error(404, `${name} ${slug ?? ""} is not an ${platform === "ios" ? "iOS" : "Android"} version.`);
  return at;
}
