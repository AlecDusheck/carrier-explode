/** What a value tree can say about a key: each family's trees are given their own (lib/apple, lib/android). */

import type { ConfigReading } from "@carrier-explode/decode-android";
import type { FieldDoc, ValueLabel } from "@carrier-explode/decode-ios";

export interface TreeDocs {
	field(key: string, path: string): FieldDoc | undefined;
	value(key: string, value: unknown, path: string): ValueLabel[] | undefined;
	/** A value with a format of its own, or a key nothing documents; null for a plain one. */
	read(key: string, path: string, value: unknown): ConfigReading | null;
}

/** For a tree whose keys nothing documents. */
export const NO_DOCS: TreeDocs = { field: () => undefined, value: () => undefined, read: () => null };
