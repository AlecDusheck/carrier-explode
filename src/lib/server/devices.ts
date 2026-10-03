/**
 * Phones by platform: what a device id is called and which is newest. Apple
 * ids are product types (iPhone18,1), named by the iOS decoder's board table;
 * Android ids are Pixel codenames (tokay), named and ranked by the schema's.
 */

import { compareProducts, productName } from "#lib/decode/index.ts";
import { byPixelRank, pixelName } from "#lib/schema/index.ts";
import type { Platform } from "#lib/schema/types.ts";

interface Naming {
  readonly name: (id: string) => string;
  /** Newest first. */
  readonly order: (a: string, b: string) => number;
}

const apple: Naming = { name: (id) => productName(id) ?? id, order: (a, b) => compareProducts(b, a) };
const android: Naming = { name: pixelName, order: byPixelRank };

export const DEVICES = { ios: apple, ipados: apple, watchos: apple, android } as const satisfies Record<Platform, Naming>;

/** A platform's device ids, newest first, with their names. */
export const named = (platform: Platform, ids: readonly string[]): Array<{ id: string; name: string }> =>
  [...ids].sort(DEVICES[platform].order).map((id) => ({ id, name: DEVICES[platform].name(id) }));
