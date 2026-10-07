/** Confseqs (`carrierconfig/confseqs/<sha1>`): one named layer of modem configuration items, maybe CLZ4-compressed. */

import { asciiAt, decodeLz4Block, slice, u32le, wireFields } from "@carrier-explode/binary";
import { int, required, ShannonFormatError, text, unexpected } from "./wire.ts";

interface ConfigItem {
	/** CRC-32 of the item's name; `itemTable` defines it from a modem image. */
	readonly hash: number;
	/** One int64 per element, whatever the element's type; `itemValue` reads them at it. */
	readonly values: readonly bigint[];
}

export interface Confseq {
	readonly version: string;
	/** `<layer>.<scope>`, e.g. `us_tmo.sim1`, `lte_ca_common.common`. */
	readonly name: string;
	readonly items: readonly ConfigItem[];
}

const CLZ4_HEADER = 16;

/** `CLZ4`, u32le decompressed size, u32le block size, 4 unidentified bytes, the LZ4 block, zeros to a 4-byte boundary. */
function unwrapClz4(b: Uint8Array): Uint8Array {
	if (!asciiAt(b, 0, "CLZ4")) return b;
	const size = u32le(b, 4);
	const blockSize = u32le(b, 8);
	const end = CLZ4_HEADER + blockSize;
	if (b.length !== end + ((4 - (end % 4)) % 4) || slice(b, end, b.length - end).some((x) => x !== 0)) {
		throw new ShannonFormatError(`CLZ4 block of ${blockSize} bytes does not end a ${b.length}-byte file`);
	}
	return decodeLz4Block(slice(b, CLZ4_HEADER, blockSize), size);
}

/** One value: field 3 holds the int64, left out when it is 0. */
function value(b: Uint8Array): bigint {
	let v = 0n;
	for (const f of wireFields(b)) {
		if (f.key === "3:varint") v = BigInt.asIntN(64, f.value);
		else unexpected(f, "confseq item value");
	}
	return v;
}

function item(b: Uint8Array): ConfigItem {
	let hash: number | undefined;
	const values: bigint[] = [];
	for (const f of wireFields(b)) {
		if (f.key === "1:varint") hash = int(f.value, "item hash");
		else if (f.key === "2:bytes") values.push(value(f.value));
		else unexpected(f, "confseq item");
	}
	return { hash: required(hash, "item hash"), values };
}

export function decodeConfseq(bytes: Uint8Array): Confseq {
	let version: string | undefined;
	let name: string | undefined;
	const items: ConfigItem[] = [];
	for (const f of wireFields(unwrapClz4(bytes))) {
		if (f.key === "1:bytes") version = text(f.value);
		else if (f.key === "2:bytes") name = text(f.value);
		else if (f.key === "4:bytes") items.push(item(f.value));
		else unexpected(f, "confseq");
	}
	return { version: required(version, "confseq version"), name: required(name, "confseq name"), items };
}
