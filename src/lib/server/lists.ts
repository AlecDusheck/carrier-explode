/**
 * The three lists on the left: carriers, countries and Watch bundles, one row
 * per page, from the index. A carrier row is an iOS bundle as it always was;
 * a carrier with no iOS bundle is one row under its Android name.
 */

import { splitName } from "#lib/names.ts";
import { parseSourceKey, type SourceRef } from "#lib/schema/types.ts";
import type { Kind } from "#lib/types.ts";
import { perRequest } from "./cache";
import { carrierList, countryList } from "./catalog";

export interface ListEntry {
  readonly name: string;
  readonly display: string;
  readonly cc?: string | undefined;
  /** YYYY-MM-DD: when anything of its carrier last changed, on either platform. */
  readonly updated?: string | undefined;
}

export type Lists = Readonly<Record<Kind, readonly ListEntry[]>>;

const refs = (members: readonly string[]): SourceRef[] => members.flatMap((k) => parseSourceKey(k) ?? []);
const byName = (a: ListEntry, b: ListEntry): number => a.name.localeCompare(b.name);

export const getLists = perRequest(async (): Promise<Lists> => {
  const [carriers, countries] = await Promise.all([carrierList(), countryList()]);
  const phone: ListEntry[] = [], watch: ListEntry[] = [];
  for (const c of carriers) {
    const ios = refs(c.members).filter((r) => r.platform === "ios" && r.kind === "carrier");
    const row = (name: string, display: string): ListEntry => ({ name, display, cc: c.iso ?? splitName(name).cc, updated: c.updated });
    const bundles = ios.filter((r) => !r.family);
    if (bundles.length) phone.push(...bundles.map((r) => row(r.name, splitName(r.name).display)));
    else if (c.platforms.includes("android")) phone.push(row(c.slug, c.name));
    watch.push(...ios.filter((r) => r.family === "Watch").map((r) => row(r.name, splitName(r.name).display)));
  }
  const country = countries.flatMap((c) => refs(c.countryBundles).filter((r) => !r.family).map((r): ListEntry => ({ name: r.name, display: r.name, cc: c.iso })));
  return { carriers: phone.sort(byName), countries: country.sort(byName), watch: watch.sort(byName) };
});

/** The carrier rows of one country, for a country bundle's Overview. */
export async function carriersIn(cc: string | undefined): Promise<string[]> {
  if (!cc) return [];
  return (await getLists()).carriers.filter((c) => c.cc === cc).map((c) => c.name);
}
