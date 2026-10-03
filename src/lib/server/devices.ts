/** Devices by platform: what an id is called and which is newest. */

import { compareProducts, productName } from "#lib/decode/index.ts";
import { byPixelRank } from "#lib/schema/index.ts";
import type { Platform } from "#lib/schema/types.ts";
import { PIXELS } from "#lib/pixels.ts";

interface Naming {
  readonly name: (id: string) => string;
  /** Newest first. */
  readonly order: (a: string, b: string) => number;
}

/** Apple ids are product types (iPhone18,1); a product the board table cannot name keeps its id. */
const apple: Naming = { name: (id) => productName(id) ?? id, order: (a, b) => compareProducts(b, a) };
/** Android ids are Pixel codenames (tokay); one the table cannot name keeps its codename. */
const android: Naming = { name: (id) => PIXELS[id]?.name ?? id, order: byPixelRank };

export const DEVICES = { ios: apple, ipados: apple, watchos: apple, android } as const satisfies Record<Platform, Naming>;

export interface Named {
  readonly id: string;
  readonly name: string;
}

/** A platform's device ids, newest first, named. */
export const named = (platform: Platform, ids: readonly string[]): Named[] =>
  [...ids].sort(DEVICES[platform].order).map((id) => ({ id, name: DEVICES[platform].name(id) }));
