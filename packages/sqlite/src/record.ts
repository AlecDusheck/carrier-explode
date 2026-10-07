/** The record format: a header of serial types, then each column's value. */

import { slice, view } from "@carrier-explode/binary";
import { signedBE, sizeVarint, SqliteError } from "./bytes.ts";

/** A stored value. Integers are numbers when they fit a safe integer, else bigints. */
export type SqlValue = null | number | bigint | string | Uint8Array;

/** Bytes of the integer serial types 1..6. */
const INT_WIDTH = [0, 1, 2, 3, 4, 6, 8] as const;

export function decodeRecord(payload: Uint8Array, text: (b: Uint8Array) => string): SqlValue[] {
	const header = sizeVarint(payload, 0);
	const values: SqlValue[] = [];
	let body = header.value;
	for (let at = header.next; at < header.value;) {
		const t = sizeVarint(payload, at);
		at = t.next;
		const type = t.value;
		const width = INT_WIDTH[type];
		if (type === 0) values.push(null);
		else if (width !== undefined) {
			values.push(signedBE(payload, body, width));
			body += width;
		} else if (type === 7) {
			values.push(view(slice(payload, body, 8)).getFloat64(0, false));
			body += 8;
		} else if (type === 8 || type === 9) values.push(type - 8);
		else if (type >= 12) {
			const size = (type - 12) >> 1;
			const bytes = slice(payload, body, size);
			// A copy, as a plain Uint8Array whatever view the file came in.
			values.push(type % 2 === 0 ? new Uint8Array(bytes) : text(bytes));
			body += size;
		} else throw new SqliteError(`reserved serial type ${type}`);
	}
	if (body !== payload.length)
		throw new SqliteError(`record body ends at ${body} of ${payload.length} bytes`);
	return values;
}
