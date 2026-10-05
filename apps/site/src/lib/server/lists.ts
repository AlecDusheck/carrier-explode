/** The lists on the left: one platform's sources of one kind, from the index; for a platform with no country files, the countries of its carriers. */

import { carrierCountries, countryCarriers, listedPlatforms, listedSources, sourceBrands, sourceKeys, sourceList, type ListedSource } from "@carrier-explode/db/d1";
import { listPath, shipsKind, sourcePath, type Platform, type SourceKey, type SourceKind } from "@carrier-explode/schema/types";
import type { Picture } from "#lib/types.ts";
import { perRequest } from "./cache";
import { db } from "./db";
import { pictureOf } from "./pictures";

/** A row of a list: what the pane shows and links to. */
export interface ListRow {
  readonly path: string;
  readonly name: string;
  /** What people call the carrier: `AT&T` for ATT_US. */
  readonly brand: string;
  readonly picture: Picture;
  readonly cc: string | undefined;
  /** YYYY-MM-DD: the newest change of its carrier, any platform. */
  readonly updated: string | null;
}

/** A row that is a source the index has. */
export interface ListEntry extends ListRow {
  readonly key: SourceKey;
  readonly platform: Platform;
}

function entryOf({ key, platform, kind, name, carrier }: ListedSource): ListEntry {
  const ref = { platform, kind, name };
  return {
    key, path: sourcePath(ref), platform, name, brand: carrier.name,
    picture: pictureOf(ref, carrier), cc: carrier.iso ?? undefined, updated: carrier.updated,
  };
}

export const getList = perRequest(async (platform: Platform, kind: SourceKind): Promise<ListEntry[]> =>
  (await sourceList(await db(), platform, kind)).map(entryOf));

/** A country a platform's carriers are in, as a row: its page lists them. */
const countryRow = (platform: Platform) => ({ iso, name }: { readonly iso: string; readonly name: string }): ListRow => ({
  path: `${listPath(platform, "country")}/${iso}`, name: iso, brand: name, picture: { kind: "flag", cc: iso }, cc: iso, updated: null,
});

/** The pane's list: the platform's sources of `kind`; for countries on a platform that ships no country files, the countries its carriers are in. */
export const getListRows = perRequest(async (platform: Platform, kind: SourceKind): Promise<ListRow[]> =>
  kind === "country" && !shipsKind(platform, "country") ? (await carrierCountries(await db(), platform)).map(countryRow(platform)) : getList(platform, kind));

/** A platform's carriers in one country. */
export const getCountryCarriers = perRequest(async (platform: Platform, iso: string): Promise<ListEntry[]> =>
  (await countryCarriers(await db(), platform, iso)).map(entryOf));

/** The entries of `keys` the index has. */
export async function listEntries(keys: readonly SourceKey[]): Promise<ReadonlyMap<SourceKey, ListEntry>> {
  return new Map((await listedSources(await db(), keys)).map((s) => [s.key, entryOf(s)]));
}

export const allSourceKeys = perRequest(async (): Promise<SourceKey[]> => sourceKeys(await db()));

/** Every source with its carrier's name, by key. */
export const allSourceBrands = perRequest(async (): Promise<Array<{ readonly key: SourceKey; readonly brand: string }>> => sourceBrands(await db()));

/** The platforms each kind of list has entries on; a platform with carriers but no country files lists its carriers' countries. */
export const listPlatforms = perRequest(async (): Promise<ReadonlyMap<SourceKind, ReadonlySet<Platform>>> => {
  const out = new Map<SourceKind, Set<Platform>>();
  const add = (kind: SourceKind, platform: Platform): void => void out.set(kind, (out.get(kind) ?? new Set()).add(platform));
  for (const { platform, kind } of await listedPlatforms(await db())) add(kind, platform);
  for (const platform of out.get("carrier") ?? []) if (!shipsKind(platform, "country")) add("country", platform);
  return out;
});
