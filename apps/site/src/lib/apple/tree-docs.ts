/** What a value tree says about an Apple bundle's keys: decode-ios's field docs, small enough to ship whole. */

import { describeField, describeValue } from "@carrier-explode/decode-ios";
import type { TreeDocs } from "#lib/tree-docs.ts";

export const APPLE_DOCS: TreeDocs = { field: describeField, value: describeValue, read: () => null };
