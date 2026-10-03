/**
 * What a value tree can say about a key, per platform. Android's CarrierConfig
 * docs are too large to ship to the browser; its Settings tab shows them instead.
 */

import { describeField, describeValue, type FieldDoc, type ValueLabel } from "#lib/decode/index.ts";
import type { Platform } from "#lib/schema/types.ts";

export interface TreeDocs {
  field(key: string, path: string): FieldDoc | undefined;
  value(key: string, value: unknown, path: string): ValueLabel[] | undefined;
}

const apple: TreeDocs = { field: describeField, value: describeValue };

export const TREE_DOCS = { ios: apple, ipados: apple, watchos: apple, android: null } as const satisfies Record<Platform, TreeDocs | null>;
