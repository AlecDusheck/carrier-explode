/** The lists on the left: one row per source, every platform, from the index. */

import { error } from "@sveltejs/kit";
import { splitName } from "#lib/names.ts";
import { parseSourceKey, sourcePath, type Platform, type SourceKind } from "#lib/schema/types.ts";
import { perRequest } from "./cache";
import { carrierList, countryList } from "./catalog";

export interface ListEntry {
  readonly path: string;
  readonly platform: Platform;
  readonly name: string;
  readonly display: string;
  readonly cc: string | undefined;
  /** YYYY-MM-DD: the newest change of its carrier, any platform. */
  readonly updated: string | undefined;
}

export type Lists = Readonly<Record<SourceKind, readonly ListEntry[]>>;

const byName = (a: ListEntry, b: ListEntry): number => a.name.localeCompare(b.name) || a.platform.localeCompare(b.platform);

export const getLists = perRequest(async (): Promise<Lists> => {
  const [carriers, countries] = await Promise.all([carrierList(), countryList()]);
  const out: Record<SourceKind, ListEntry[]> = { carrier: [], country: [], default: [] };
  const add = (key: string, cc: string | undefined, updated: string | undefined): void => {
    const ref = parseSourceKey(key);
    if (!ref) error(500, `The index lists ${key}, which is not a source key.`);
    out[ref.kind].push({ path: sourcePath(ref), platform: ref.platform, name: ref.name, display: splitName(ref.name).display, cc, updated });
  };
  // Country bundles are listed by country, with its code.
  for (const c of carriers) for (const k of c.members) if (parseSourceKey(k)?.kind !== "country") add(k, c.iso, c.updated);
  for (const c of countries) for (const k of c.countryBundles) add(k, c.iso, undefined);
  return { carrier: out.carrier.sort(byName), country: out.country.sort(byName), default: out.default.sort(byName) };
});
