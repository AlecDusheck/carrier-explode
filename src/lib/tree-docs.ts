/**
 * What a value tree can say about a key it shows, per platform. iOS keys are
 * documented in the decoder's field table, which is small enough to ship to the
 * browser. Android's CarrierConfig docs are megabytes of javadoc, so they stay
 * on the server and reach the page through the Settings tab instead.
 */

import { describeField, describeValue, type FieldDoc, type ValueLabel } from "#lib/decode/index.ts";
import type { Platform } from "#lib/schema/types.ts";

export interface TreeDocs {
  field(key: string, path: string): FieldDoc | undefined;
  value(key: string, value: unknown, path: string): ValueLabel[] | undefined;
}

export const TREE_DOCS = {
  ios: { field: describeField, value: describeValue },
  android: null,
} as const satisfies Record<Platform, TreeDocs | null>;
