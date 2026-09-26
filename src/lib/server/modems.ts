/** Modem packages: where their summaries are stored, an image's package as the pages show it, and which bundle copy holds a phone's files. */

import { MODEM_SUMMARY_SCHEMA, modemVendor, productName } from "$lib/decode";
import { compareVersions } from "$lib/names";
import type { TimelineEntry } from "$lib/types";
import type { ImageModem } from "./timeline";

/** R2 key of package `id`'s decoded summary. Written by scripts/baseband.ts, read by the worker. */
export const summaryKey = (id: string) => `baseband/v${MODEM_SUMMARY_SCHEMA}/${id}.json`;

export const modemView = (m: ImageModem) => ({
  family: m.family,
  vendor: modemVendor(m.family),
  package: { id: m.package.id, name: m.package.name, size: m.package.size, kind: m.package.kind },
  devices: m.devices.map((id) => ({ id, name: productName(id) })),
});
export type ModemView = ReturnType<typeof modemView>;

type Copy = Pick<TimelineEntry, "source" | "build" | "productType">;

/**
 * The copies of a bundle worth opening for `phone`'s override files, in the
 * order to try them: `from` itself, then OTA copies (plain, or made for that
 * phone, at most `limit` of them), the same build first, then newest build
 * first. An image's copy only holds the files of the extracting phone's modem
 * family; OTA copies usually hold every phone's.
 */
export function overrideCandidates<E extends Copy>(timeline: E[], from: E, phone: string, limit: number): E[] {
  const ota = timeline
    .filter((e) => e !== from && e.source === "ota" && (!e.productType || e.productType === phone))
    .sort((a, b) => Number(b.build === from.build) - Number(a.build === from.build) || compareVersions(b.build || "0", a.build || "0"));
  return [from, ...ota].slice(0, limit + 1);
}

/**
 * The first candidate whose files `match` finds anything in, else whether any
 * candidate `knows` the phone (was made while it existed), so that its having
 * no files means it has none. A candidate other than the first that cannot be
 * read is skipped; `undefined` then means "not found, but not known to be
 * absent", which is not worth remembering.
 */
export async function firstCopyWith<E, F>(
  candidates: E[],
  filesOf: (e: E) => Promise<F[]>,
  match: (files: F[]) => F[],
  knows: (files: F[]) => boolean,
): Promise<{ entry: E; files: F[] } | { entry: null; known: boolean } | undefined> {
  let unread = false;
  let known = false;
  for (const [i, entry] of candidates.entries()) {
    let all: F[];
    try {
      all = await filesOf(entry);
    } catch (e) {
      if (i === 0) throw e;
      unread = true;
      continue;
    }
    const files = match(all);
    if (files.length) return { entry, files };
    known ||= knows(all);
  }
  return unread ? undefined : { entry: null, known };
}
