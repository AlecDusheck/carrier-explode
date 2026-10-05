/**
 * source.android.com's build numbers: every Android build with the devices it supports and its security patch level. It
 * keeps the builds the OTA page drops (Google removes a phone's history when it forces an update on it), so it dates a
 * Pixel's first build when the OTA page no longer can.
 */

import { fetchWithRetry } from "@carrier-explode/http";

export const BUILD_NUMBERS = "https://source.android.com/docs/setup/reference/build-numbers";

const ENTITIES = new Map([["&amp;", "&"], ["&quot;", '"'], ["&#39;", "'"], ["&lt;", "<"], ["&gt;", ">"]]);
const cellText = (html: string): string => html.replace(/<[^>]+>/g, "").replace(/&[#\w]+;/g, (e) => ENTITIES.get(e) ?? e).trim();

/** A device name reduced for matching: the pages write `Pixel 8 Pro` and `Pixel 8 pro`, `Pixel 4a (5G)` and `Pixel 4a 5G`. */
export const foldName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Folded device name -> YYYY-MM of the earliest security patch level of a build that supports it. */
export function firstPatches(html: string): ReadonlyMap<string, string> {
  const start = html.indexOf('id="source-code-tags-and-builds"');
  const end = html.indexOf("</table>", start);
  if (start < 0 || end < 0) throw new Error(`${BUILD_NUMBERS}: no table of builds; its layout changed`);
  const first = new Map<string, string>();
  for (const [row] of html.slice(start, end).matchAll(/<tr>[\s\S]*?<\/tr>/g)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1] ?? ""));
    const [, , , supported, patch] = cells;
    const month = /^(\d{4}-\d{2})-\d{2}$/.exec(patch ?? "")?.[1];
    if (cells.length !== 5 || supported === undefined || month === undefined) continue;
    // One row separates its devices with a full-width comma.
    for (const name of supported.split(/[,，]/).map(foldName).filter(Boolean)) {
      const held = first.get(name);
      if (held === undefined || month < held) first.set(name, month);
    }
  }
  if (first.size === 0) throw new Error(`${BUILD_NUMBERS}: no build names a device with a patch level; its layout changed`);
  return first;
}

export const fetchFirstPatches = async (): Promise<ReadonlyMap<string, string>> => firstPatches(await (await fetchWithRetry(BUILD_NUMBERS)).text());
