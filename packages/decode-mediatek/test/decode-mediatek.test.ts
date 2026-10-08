/**
 * Fixtures are altered re-serializations of Pixel 11 (a900a) MCF files: APN strings, flag
 * values and a condition's match bytes changed, checksums recomputed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BoundsError } from "@carrier-explode/binary";
import { describe, expect, it } from "vitest";
import { decodeNwOta, decodeOpOta, McfError } from "../src/index.ts";

const fixture = (name: string): Uint8Array =>
	new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));
const text = (b: Uint8Array): string => new TextDecoder().decode(b);
const BUILD = "a900a-MP_260716-260716-M-158803482026.0716.2351092.2532.00.0";

/** Recomputes every section checksum and the file sum, so an edit reaches the record parser. */
function reseal(bytes: Uint8Array): Uint8Array {
	const out = bytes.slice();
	const v = new DataView(out.buffer);
	let at = v.getUint32(4, true);
	let total = 0;
	for (let n = v.getUint16(14, true); n > 0 && at + 40 <= out.length; n--) {
		const length = v.getUint32(at + 4, true);
		if (length < 40 || length % 4 || at + length > out.length) break;
		v.setUint32(at + 0x24, 0, true);
		let sum = 0;
		for (let i = 0; i < length; i += 4) sum = (sum + v.getUint32(at + i, true)) >>> 0;
		v.setUint32(at + 0x24, -sum >>> 0, true);
		total = (total + sum) >>> 0;
		at += length;
	}
	v.setUint32(0x1c, total, true);
	return out;
}

const firstRecord = (bytes: Uint8Array): number =>
	new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true) + 40;

function rejects(bytes: Uint8Array, code: McfError["code"]): void {
	const error: unknown = (() => {
		try {
			decodeOpOta(bytes);
		} catch (e) {
			return e;
		}
		return undefined;
	})();
	expect(error).toBeInstanceOf(McfError);
	expect(error instanceof McfError && error.code).toBe(code);
}

describe("OP-OTA", () => {
	const file = decodeOpOta(fixture("op-ota.mcfopota"));

	it("reads the header and LID table", () => {
		expect(file.header.build).toBe(BUILD);
		expect(file.header.lids.map((l) => [l.lid, l.itemIds.length])).toEqual([
			[0x3c0, 1],
			[0x3c1, 1],
			[0x542, 2],
			[0x88f, 14],
		]);
	});

	it("decodes conditions, array paths and values", () => {
		expect(file.records).toHaveLength(32);
		const apn = file.records.find((r) => r.itemId === 0x20ce);
		expect(apn?.lid).toBe(0x88f);
		expect(apn?.condition).toEqual({ kind: "plmn", sbpId: 108, mcc: "466", mnc: "97" });
		expect(apn?.values.map((v) => [v.path, text(v.bytes)])).toEqual([
			[[0, 0], "examplea\0"],
			[[1, 0], "ims\0"],
			[[2, 0], "xyz\0"],
		]);
		const scalar = file.records.find((r) => r.itemId === 0x7130);
		expect(scalar?.condition).toEqual({ kind: "plmn", sbpId: 108, mcc: null, mnc: null });
		expect(scalar?.values).toEqual([{ path: [], bytes: Uint8Array.of(0x0c) }]);
	});

	it("decodes a segmented condition", () => {
		const [record] = decodeOpOta(fixture("op-ota-segments.mcfopota")).records;
		expect(record?.condition).toEqual({
			kind: "segments",
			segments: [
				{ kind: "header", length: 8, tag: 0x467f },
				{ kind: "plmn", sbpId: 154, mcc: "242", mnc: "02" },
				{ kind: "bytes", bytes: Uint8Array.of(0x42, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff) },
			],
		});
	});
});

describe("NW-OTA", () => {
	it("reads records across sections", () => {
		const file = decodeNwOta(fixture("nw-ota.mcfnwota"));
		expect(file.records.map((r) => r.itemId)).toEqual([0x719c, 0x719e, 0x719f, 0x71a0, 0x71a1, 0x71a2]);
		expect(
			file.records.every((r) => r.lid === 0x3c0 && r.values.length === 1 && r.values[0]?.bytes[0] === 0),
		).toBe(true);
	});
});

describe("malformed input", () => {
	const op = fixture("op-ota.mcfopota");

	it("checks the magic, kind and checksums", () => {
		rejects(Uint8Array.of(...op.subarray(0, 8), 0, 0, 0, 0, ...op.subarray(12)), "magic");
		const unknown = op.slice();
		unknown.set(new TextEncoder().encode("XX"), 0x14);
		rejects(unknown, "kind");
		const flipped = op.slice();
		flipped[op.length - 1] = (flipped[op.length - 1] ?? 0) ^ 1;
		rejects(flipped, "checksum");
		rejects(Uint8Array.of(...op, 0, 0, 0, 0), "layout");
		expect(() => decodeNwOta(op)).toThrow(McfError);
	});

	it("rejects truncation with a typed error", () => {
		for (const cut of [4, 16, 40, 0xc4, op.length - 4]) {
			expect(() => decodeOpOta(op.subarray(0, cut))).toThrow(
				expect.toSatisfy((e) => e instanceof McfError || e instanceof BoundsError),
			);
		}
	});

	it("rejects a bad condition and a bad path", () => {
		const at = firstRecord(op);
		const tag = op.slice();
		tag[at + 12] = "x".charCodeAt(0);
		rejects(reseal(tag), "tag");
		const path = op.slice();
		const value = at + 12 + (((op[at + 9] ?? 0) + 3) & ~3);
		const v = new DataView(path.buffer);
		v.setUint16(value, 1, true);
		v.setUint16(value + 2, 0, true);
		path[value + 4] = "$".charCodeAt(0);
		rejects(reseal(path), "path");
	});

	it("ends on every single-byte change with the checksums repaired", () => {
		for (const [name, decode] of [
			["op-ota.mcfopota", decodeOpOta],
			["op-ota-segments.mcfopota", decodeOpOta],
			["nw-ota.mcfnwota", decodeNwOta],
		] as const) {
			const original = fixture(name);
			for (let i = 0; i < original.length; i++) {
				for (const value of [0x00, 0xff, (original[i] ?? 0) + 1]) {
					const bytes = original.slice();
					bytes[i] = value & 0xff;
					try {
						decode(reseal(bytes));
					} catch (e) {
						if (!(e instanceof McfError || e instanceof BoundsError)) throw e;
					}
				}
			}
		}
	});
});
