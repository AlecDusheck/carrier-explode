/** A confseq value read as its registry type: confseqs store every element as an int64 whatever its width. */

import { type ItemDef, ITEM_TYPE_SIZES } from "./item-table.ts";
import { ShannonFormatError } from "./wire.ts";

export type ItemValue =
	/** A byte array holding printable ASCII and one terminating NUL. */
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "numbers"; readonly values: readonly bigint[] };

// Plain char is unsigned on Arm (AAPCS).
const SIGNED = new Set<ItemDef["type"]>(["s8", "s16", "s32", "s64"]);
const BYTES = new Set<ItemDef["type"]>(["u8", "char"]);

const printable = (v: bigint): boolean => v >= 0x20n && v < 0x7fn;

function asText(def: ItemDef, values: readonly bigint[]): string | undefined {
	if (!BYTES.has(def.type) || def.capacity < 2 || values.length < 2 || values.at(-1) !== 0n) return undefined;
	const chars = values.slice(0, -1);
	return chars.every(printable) ? String.fromCharCode(...chars.map(Number)) : undefined;
}

/** Each element at its width: a signed byte stored as 255 is -1, a u64 stored negative is past 2^63. */
export function itemValue(def: ItemDef, values: readonly bigint[]): ItemValue {
	if (values.length > def.capacity)
		throw new ShannonFormatError(`${def.name}: ${values.length} values for ${def.capacity} elements`);
	const text = asText(def, values);
	if (text !== undefined) return { kind: "text", text };
	const bits = ITEM_TYPE_SIZES[def.type] * 8;
	return {
		kind: "numbers",
		values: values.map((v) => {
			if (v < -(1n << BigInt(bits - 1)) || v >= 1n << BigInt(bits))
				throw new ShannonFormatError(`${def.name}: ${v} does not fit ${def.type}`);
			return SIGNED.has(def.type) ? BigInt.asIntN(bits, v) : BigInt.asUintN(bits, v);
		}),
	};
}
