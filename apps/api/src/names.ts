/** The names the API shows for codes: the one place it reads them. */

import { listedSources, type IndexDb, type ListedCarrier } from "@carrier-explode/db/d1";
import type { SourceKey } from "@carrier-explode/schema/types";

/** A source's carrier as the lists name it; undefined when the index lacks the source. */
export const sourceCarrier = async (db: IndexDb, key: SourceKey): Promise<Pick<ListedCarrier, "id" | "name" | "iso"> | undefined> => {
  const [listed] = await listedSources(db, [key]);
  return listed === undefined ? undefined : { id: listed.carrier.id, name: listed.carrier.name, iso: listed.carrier.iso };
};
