/** Names for the codes pages read from records other than the index's rows (releases, bundles, timelines), from the names a publish wrote. */

import { namesOf } from "@carrier-explode/db/d1";
import type { Named, NamedSubject } from "@carrier-explode/schema/types";
import { db } from "./db";

/** Names `codes`, looked up at once; a code the index names nothing reads as itself. */
export async function namer(subject: NamedSubject, codes: readonly string[]): Promise<(code: string) => Named> {
  const names = await namesOf(await db(), subject, codes);
  return (code) => ({ code, name: names.get(code) ?? code });
}
