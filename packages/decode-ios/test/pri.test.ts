/**
 * `pri/` fixtures are altered override files (see test/README.md); `default-g-cut.der.gri` keeps the first records
 * of Default/global_setting_G.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unzlibSync } from "fflate";

import {
	decodePri,
	decodeValue,
	flattenDer,
	nvTag,
	PRI_TAGS,
	tagNumber,
	type PriDecoded,
	type PriLeaf,
	type PriValue,
} from "../src/pri.ts";
import { hexToBytes, u32le } from "@carrier-explode/binary";
import { isRecord } from "@carrier-explode/values";
import { openIpcc, decodeFile, type OpenedBundle, decodedPri } from "../src/bundle.ts";
import { parsePlist } from "../src/plist.ts";
import { array, defined, record } from "./defined.ts";

const here = dirname(fileURLToPath(import.meta.url));

const bundleCache = new Map<string, OpenedBundle>();
function bundle(name: string): OpenedBundle {
	let b = bundleCache.get(name);
	if (!b) {
		b = openIpcc(new Uint8Array(readFileSync(join(here, "fixtures", name))));
		bundleCache.set(name, b);
	}
	return b;
}

/** Raw bytes of a bundle-relative path. */
function raw(bundleName: string, path: string): Uint8Array {
	const b = bundle(bundleName);
	const bytes = b.entries[b.prefix + path];
	if (!bytes) throw new Error(`missing fixture entry ${bundleName}:${path}`);
	return bytes;
}

function pri(bundleName: string, path: string): PriDecoded {
	return decodePri(raw(bundleName, path), path.endsWith(".der.gri") ? "der.gri" : "der.pri");
}

const BUNDLES_WITH_PRI = [
	"carrier-att.ipcc",
	"carrier-airtel-in.ipcc",
	"carrier-cw-pa.ipcc",
	"carrier-cw-wi.ipcc",
	"carrier-verizon.ipcc",
];

/** Every (bundle, path) pair naming a binary .der.pri / .der.gri in the corpus. */
function allDerFiles(): Array<{ bundle: string; path: string }> {
	const out: Array<{ bundle: string; path: string }> = [];
	for (const name of BUNDLES_WITH_PRI) {
		for (const f of bundle(name).info.files) {
			if (f.kind === "pri-der") out.push({ bundle: name, path: f.path });
		}
	}
	return out;
}

const B = (...bytes: number[]) => new Uint8Array(bytes);
const S = (s: string) => new TextEncoder().encode(s);
const hex = hexToBytes;

/** Build one DER TLV: hex tag (may be multi-byte), DER length, value. */
function tlv(tagHex: string, value: Uint8Array): Uint8Array {
	const tag = hex(tagHex);
	let len: number[];
	if (value.length < 0x80) len = [value.length];
	else if (value.length < 0x100) len = [0x81, value.length];
	else if (value.length < 0x10000) len = [0x82, value.length >> 8, value.length & 0xff];
	else len = [0x83, value.length >> 16, (value.length >> 8) & 0xff, value.length & 0xff];
	return new Uint8Array([...tag, ...len, ...value]);
}

const cat = (...parts: Uint8Array[]) => {
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
};

/** Wrap `inner` in a one-byte-length constructed node (short form only). */
function wrapShort(tag: number, inner: Uint8Array): Uint8Array {
	const out = new Uint8Array(2 + inner.length);
	out[0] = tag;
	out[1] = inner.length;
	out.set(inner, 2);
	return out;
}

/** The integer of an "int" value, else undefined. */
const intOf = (v: PriValue | undefined): number | undefined => (v?.kind === "int" ? v.int : undefined);
const leavesOf = (b: Uint8Array): PriLeaf[] => flattenDer(b).leaves;
const tags = (leaves: PriLeaf[]) => leaves.map((l) => l.tag);
const vals = (leaves: PriLeaf[]) => leaves.map((l) => Array.from(l.value));

describe("flattenDer: DER container mechanics", () => {
	it("returns an empty stream for empty input", () => {
		expect(leavesOf(new Uint8Array())).toEqual([]);
	});

	it("descends SET -> context-primitive [0] -> SEQUENCE and yields only the leaf", () => {
		// 31 08  80 06  30 04  9fa711 00
		const buf = B(0x31, 0x08, 0x80, 0x06, 0x30, 0x04, 0x9f, 0xa7, 0x11, 0x00);
		const leaves = leavesOf(buf);
		expect(tags(leaves)).toEqual(["9fa711"]);
		expect(leaves[0]?.value.length).toBe(0);
	});

	it("keeps leaves in file order across sibling wrappers", () => {
		const seq = cat(tlv("9fa711", S("A")), tlv("9fa712", S("B")), tlv("9fa70c", S("C")));
		const buf = wrapShort(0x31, wrapShort(0x80, wrapShort(0x30, seq)));
		const leaves = leavesOf(buf);
		expect(tags(leaves)).toEqual(["9fa711", "9fa712", "9fa70c"]);
		expect(leaves.map((l) => new TextDecoder().decode(l.value))).toEqual(["A", "B", "C"]);
	});

	it("emits a primitive leaf with an empty value rather than dropping it", () => {
		expect(vals(leavesOf(B(0x04, 0x00)))).toEqual([[]]);
		// A zero-length constructed node has nothing to recurse into, so it stays a leaf.
		expect(tags(leavesOf(B(0x30, 0x00)))).toEqual(["30"]);
		expect(tags(leavesOf(B(0x31, 0x00)))).toEqual(["31"]);
	});

	it("does not recurse into a primitive whose content happens to look like DER", () => {
		// 04 is primitive (bit 0x20 clear) so its payload must be returned verbatim.
		const leaves = leavesOf(B(0x04, 0x04, 0x04, 0x02, 0xaa, 0xbb));
		expect(tags(leaves)).toEqual(["04"]);
		expect(Array.from(defined(leaves[0]).value)).toEqual([0x04, 0x02, 0xaa, 0xbb]);
	});

	it("falls back to the constructed node itself when its content is not parseable", () => {
		// Inner bytes 04 80 throw on the length byte, so the sub-parse yields nothing.
		const leaves = leavesOf(B(0x30, 0x02, 0x04, 0x80));
		expect(tags(leaves)).toEqual(["30"]);
		expect(Array.from(defined(leaves[0]).value)).toEqual([0x04, 0x80]);
	});

	describe("length forms", () => {
		it("reads the short form", () => {
			expect(vals(leavesOf(B(0x04, 0x02, 0xaa, 0xbb)))).toEqual([[0xaa, 0xbb]]);
		});

		it("reads long form with 1, 2, 3 and 4 length bytes", () => {
			expect(vals(leavesOf(B(0x04, 0x81, 0x02, 0xaa, 0xbb)))).toEqual([[0xaa, 0xbb]]);
			expect(vals(leavesOf(B(0x04, 0x82, 0x00, 0x02, 0xaa, 0xbb)))).toEqual([[0xaa, 0xbb]]);
			expect(vals(leavesOf(B(0x04, 0x83, 0x00, 0x00, 0x02, 0xaa, 0xbb)))).toEqual([[0xaa, 0xbb]]);
			expect(vals(leavesOf(B(0x04, 0x84, 0x00, 0x00, 0x00, 0x02, 0xaa, 0xbb)))).toEqual([[0xaa, 0xbb]]);
		});

		it("reads a real 2-byte long-form length (0x82) out of a fixture", () => {
			// Every fixture .der.pri is bigger than 255 bytes, so the outer SET uses a
			// multi-byte length; misreading it gives zero leaves.
			const bytes = raw("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri");
			expect(bytes[0]).toBe(0x31);
			expect(defined(bytes[1]) & 0x80).toBe(0x80);
			expect(leavesOf(bytes).length).toBe(34);
		});

		it("stops at an unsupported long form of more than 4 length bytes", () => {
			expect(leavesOf(B(0x04, 0x85, 0, 0, 0, 0, 0x02, 0xaa, 0xbb))).toEqual([]);
		});

		it("stops at the indefinite-length marker (0x80) which DER forbids", () => {
			expect(leavesOf(B(0x04, 0x80, 0xaa))).toEqual([]);
		});

		it("stops when a declared length overruns the buffer", () => {
			expect(leavesOf(B(0x04, 0x09, 0xaa, 0xbb))).toEqual([]);
			expect(leavesOf(B(0x04, 0x84, 0xff, 0xff, 0xff, 0xff, 0x00))).toEqual([]);
		});

		it("keeps the leaves that precede an overrunning length, and says where it stopped", () => {
			const r = flattenDer(cat(tlv("9fa711", S("ok")), B(0x04, 0x7f, 0x00)));
			expect(tags(r.leaves)).toEqual(["9fa711"]);
			expect(r.stopped).toEqual({ at: 6, reason: "ASN.1 element at 6 overruns its parent" });
			expect(flattenDer(tlv("9fa711", S("ok"))).stopped).toBeUndefined();
		});

		it("reports the stop on the decoded file", () => {
			expect(decodePri(cat(tlv("9fa711", S("ok")), B(0x04, 0x7f, 0x00))).errors).toEqual([
				"DER stops at byte 6: ASN.1 element at 6 overruns its parent",
			]);
		});
	});

	describe("high-tag-number form", () => {
		it("reads tags with 1, 2, 3 and 4+ continuation bytes", () => {
			expect(tags(leavesOf(B(0x9f, 0x01, 0x01, 0xaa)))).toEqual(["9f01"]);
			expect(tags(leavesOf(B(0x9f, 0x81, 0x01, 0x01, 0xaa)))).toEqual(["9f8101"]);
			expect(tags(leavesOf(B(0x9f, 0x81, 0x81, 0x01, 0x01, 0xaa)))).toEqual(["9f818101"]);
			// The long-form Qualcomm path tag: 8 continuations.
			expect(
				tags(leavesOf(B(0x9f, 0x98, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0xa7, 0x0c, 0x01, 0xaa))),
			).toEqual(["9f98808080808080a70c"]);
		});

		it("renders the tag as lowercase hex of the raw identifier octets", () => {
			const leaves = leavesOf(tlv("9f83e43c", new Uint8Array(25)));
			expect(leaves[0]?.tag).toBe("9f83e43c");
			expect(leaves[0]?.tag).toMatch(/^[0-9a-f]+$/);
		});

		it("terminates on an unterminated continuation running off the end", () => {
			// The length byte would be past the end, so no leaf is fabricated.
			const leaves = leavesOf(B(0x9f, 0x81, 0x81));
			expect(leaves.length).toBe(0);
		});
	});

	describe("recursion depth", () => {
		const nested = (n: number) => {
			let x: Uint8Array = B(0x04, 0x02, 0xaa, 0xbb);
			for (let k = 0; k < n; k++) x = wrapShort(0x30, x);
			return x;
		};

		it("flattens through up to seven levels of constructed nesting", () => {
			for (let n = 0; n <= 6; n++) {
				const leaves = leavesOf(nested(n));
				expect(tags(leaves), `nesting ${n}`).toEqual(["04"]);
				expect(Array.from(defined(leaves[0]).value)).toEqual([0xaa, 0xbb]);
			}
		});

		it("stops descending at depth 6 and returns the wrapper as a leaf", () => {
			const leaves = leavesOf(nested(7));
			expect(tags(leaves)).toEqual(["30"]);
			expect(Array.from(defined(leaves[0]).value)).toEqual([0x04, 0x02, 0xaa, 0xbb]);
		});

		it("does not blow the stack on deeply nested input", () => {
			expect(() => leavesOf(nested(40))).not.toThrow();
			expect(leavesOf(nested(40)).length).toBe(1);
		});
	});

	it("never throws on any prefix of a real file", () => {
		const bytes = raw("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri");
		for (let i = 0; i <= bytes.length; i++) {
			expect(() => leavesOf(bytes.subarray(0, i))).not.toThrow();
		}
	});
});

describe("decodeValue", () => {
	it("reports an empty value", () => {
		const v = decodeValue(new Uint8Array());
		expect(v).toEqual({ kind: "empty", text: "(empty)", hex: "", len: 0 });
	});

	it("decodes 1..8 byte values as little-endian integers", () => {
		expect(decodeValue(B(0x00))).toMatchObject({ kind: "int", int: 0, text: "0", len: 1 });
		expect(decodeValue(B(0xff))).toMatchObject({ kind: "int", int: 255 });
		expect(decodeValue(B(0x01, 0x00))).toMatchObject({ kind: "int", int: 1 });
		expect(decodeValue(B(0x00, 0x01))).toMatchObject({ kind: "int", int: 256 });
		expect(decodeValue(B(0x01, 0x00, 0x00, 0x00))).toMatchObject({ kind: "int", int: 1 });
		expect(decodeValue(hex("ffbe"))).toMatchObject({ kind: "int", int: 48895 });
		expect(decodeValue(hex("0d010200"))).toMatchObject({ kind: "int", int: 131341 });
		expect(decodeValue(hex("1c00"))).toMatchObject({ kind: "int", int: 28 });
	});

	it("treats an all-NUL value as the integer zero, not as an empty string", () => {
		expect(decodeValue(B(0, 0, 0, 0))).toMatchObject({ kind: "int", int: 0, len: 4 });
	});

	it("decodes a value NUL-padded to a fixed width as a scalar", () => {
		// 78 00 00 00 is 120, not the string "x".
		expect(decodeValue(B(0x78, 0, 0, 0))).toMatchObject({ kind: "int", int: 120 });
		expect(decodeValue(B(0x61, 0x00))).toMatchObject({ kind: "int", int: 97 });
		expect(decodeValue(S("GWL\0\0\0\0\0"))).toMatchObject({ kind: "int", int: 5003079 });
	});

	it("decodes a single printable byte as a scalar", () => {
		expect(decodeValue(B(0x78))).toMatchObject({ kind: "int", int: 120 });
		expect(decodeValue(S("a"))).toMatchObject({ kind: "int", int: 97 });
	});

	it("decodes a short dotted version as text", () => {
		expect(decodeValue(S("1.3.193"))).toMatchObject({ kind: "string", text: "1.3.193" });
		expect(decodeValue(S("0.0.1"))).toMatchObject({ kind: "string", text: "0.0.1" });
		expect(decodeValue(S("12.1.9"))).toMatchObject({ kind: "string", text: "12.1.9" });
	});

	it("decodes a short word as text", () => {
		expect(decodeValue(S("GWL"))).toMatchObject({ kind: "string", text: "GWL" });
		expect(decodeValue(S("ab"))).toMatchObject({ kind: "string", text: "ab" });
		expect(decodeValue(S("/nv/item"))).toMatchObject({ kind: "string", text: "/nv/item" });
		expect(decodeValue(S("::"))).toMatchObject({ kind: "string", text: "::" });
	});

	it("decodes a short run of bare digits as an integer, not as text", () => {
		// No letters and not a dotted version, so it is not "meaningful" text.
		expect(decodeValue(S("12345678"))).toMatchObject({ kind: "int" });
	});

	it("switches to text above the 8-byte scalar window", () => {
		expect(decodeValue(S("123456789"))).toMatchObject({ kind: "string", text: "123456789" });
		expect(decodeValue(B(1, 0, 0, 0, 0, 0, 0, 0, 0))).toMatchObject({ kind: "bytes", len: 9 });
	});

	it("strips NUL padding from longer ASCII values", () => {
		const padded = new Uint8Array(16);
		padded.set(S("hello.world"));
		const v = decodeValue(padded);
		expect(v.kind).toBe("string");
		expect(v.text).toBe("hello.world");
		expect(v.len).toBe(16);
		expect(v.hex).toBe("68656c6c6f2e776f726c640000000000");
	});

	it("accepts tab, newline and carriage return as printable", () => {
		expect(decodeValue(S("a\tb\nc\r\n---"))).toMatchObject({ kind: "string", text: "a\tb\nc\r\n---" });
	});

	it("rejects DEL (0x7f) and other control bytes as text", () => {
		expect(decodeValue(B(0x7f, 65, 65, 65, 65, 65, 65, 65, 65, 65))).toMatchObject({
			kind: "bytes",
			len: 10,
		});
	});

	it("returns an entire XML document as kind xml", () => {
		const doc = '<?xml version="1.0"?><x/>';
		const v = decodeValue(S(doc));
		expect(v.kind).toBe("xml");
		expect(v.text).toBe(doc);
	});

	it("tolerates leading whitespace and trailing NULs around an XML document", () => {
		expect(decodeValue(S('  <?xml version="1.0"?><x/>')).kind).toBe("xml");
		const trailing = new Uint8Array(S('<?xml version="1.0"?><x/>').length + 3);
		trailing.set(S('<?xml version="1.0"?><x/>'));
		const v = decodeValue(trailing);
		expect(v.kind).toBe("xml");
		expect(v.text).toBe('<?xml version="1.0"?><x/>');
	});

	it("treats a whole element as xml, declaration or not, and leaves other text alone", () => {
		expect(decodeValue(S("<plist><dict/></plist>")).kind).toBe("xml");
		expect(decodeValue(S("<a> is less than b")).kind).toBe("string");
		expect(decodeValue(S("x <tag/>")).kind).toBe("string");
	});

	it("returns opaque binary as kind bytes with a length summary", () => {
		const v = decodeValue(B(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 200));
		expect(v.kind).toBe("bytes");
		expect(v.text).toBe("12 bytes");
		expect(intOf(v)).toBeUndefined();
		expect(v.hex).toBe("000102030405060708090ac8");
	});

	it("always reports hex and len for every kind", () => {
		for (const b of [
			new Uint8Array(),
			B(1),
			S("GWL"),
			S('<?xml version="1.0"?>'),
			B(0, 1, 2, 255, 3, 4, 5, 6, 7, 8, 9),
		]) {
			const v = decodeValue(b);
			expect(v.len).toBe(b.length);
			expect(v.hex.length).toBe(b.length * 2);
		}
	});

	describe("preferText", () => {
		it("keeps a NUL-padded meaningful word as text", () => {
			expect(decodeValue(S("GWL\0\0\0\0\0"), true)).toMatchObject({ kind: "string", text: "GWL" });
		});

		it("leaves values that are not printable as integers", () => {
			expect(decodeValue(B(0, 0, 0, 0), true)).toMatchObject({ kind: "int", int: 0 });
			expect(decodeValue(hex("ffbe"), true)).toMatchObject({ kind: "int", int: 48895 });
			expect(decodeValue(B(0x01, 0x00, 0x7f), true)).toMatchObject({ kind: "int" });
		});

		it("takes printable digits as text, because the field declares a string type", () => {
			// Only reached where the format itself says the value is a string: a name
			// pair value, or a %qu[N] fixed-width field.
			expect(decodeValue(S("12345678"), true)).toMatchObject({ kind: "string", text: "12345678" });
			expect(decodeValue(S("302\0\0\0\0\0"), true)).toMatchObject({ kind: "string", text: "302" });
		});

		it("does not change values longer than the 8-byte scalar window", () => {
			expect(decodeValue(S("123456789"), true)).toMatchObject({ kind: "string" });
			expect(decodeValue(B(0, 1, 2, 3, 4, 5, 6, 7, 8, 255), true)).toMatchObject({ kind: "bytes" });
		});

		it("overrides the NUL-padding-means-scalar rule (used for name/value pairs)", () => {
			// With preferText, 78 00 00 00 reads as "x", not 120.
			expect(decodeValue(B(0x78, 0, 0, 0), true)).toMatchObject({ kind: "string", text: "x" });
		});
	});
});

describe("decodePri over the whole fixture corpus", () => {
	const files = allDerFiles();

	it("decodes every file without an error and with a non-zero leaf count", () => {
		for (const f of files) {
			const d = pri(f.bundle, f.path);
			expect(d.errors, `${f.bundle}:${f.path}`).toEqual([]);
			expect(d.leafCount, `${f.bundle}:${f.path}`).toBeGreaterThan(0);
		}
	});

	it("echoes the requested kind and derives .der.gri from the extension", () => {
		for (const f of files) {
			const expected = f.path.endsWith(".der.gri") ? "der.gri" : "der.pri";
			expect(pri(f.bundle, f.path).kind).toBe(expected);
		}
		expect(decodePri(new Uint8Array()).kind).toBe("der.pri");
	});

	it("gives every EFS entry a non-empty path and a defined value", () => {
		let total = 0;
		for (const f of files) {
			for (const e of pri(f.bundle, f.path).efs) {
				total++;
				expect(e.path.length, `${f.bundle}:${f.path}`).toBeGreaterThan(0);
				expect(e.value).toBeDefined();
				expect(e.value.kind).toBeDefined();
				expect(e.value.len).toBe(e.value.hex.length / 2);
				expect(e.tag.length).toBeGreaterThan(0);
			}
		}
		expect(total).toBe(8546);
	});

	it("never leaves an EFS entry with an unpaired (empty) value in the corpus", () => {
		for (const f of files) {
			for (const e of pri(f.bundle, f.path).efs) {
				expect(e.value.kind, `${f.bundle}:${f.path} ${e.path}`).not.toBe("empty");
			}
		}
	});

	it("gives every feature group total 25 and bit indices below 25", () => {
		let groups = 0;
		for (const f of files) {
			for (const g of pri(f.bundle, f.path).featureGroups) {
				groups++;
				expect(g.total).toBe(25);
				expect(g.hex.length).toBe(50);
				expect(g.name.length).toBeGreaterThan(0);
				for (const bit of g.bits) {
					expect(bit).toBeGreaterThanOrEqual(0);
					expect(bit).toBeLessThan(25);
				}
				expect([...g.bits].toSorted((a, b) => a - b)).toEqual(g.bits);
			}
		}
		expect(groups).toBe(70);
	});

	it("keeps schema.count in step with schema.paths and every path rooted at /", () => {
		for (const f of files) {
			const s = pri(f.bundle, f.path).schema;
			expect(["MAVZ", "raw", "none"]).toContain(s.source);
			expect(s.count).toBe(s.paths.length);
			for (const p of s.paths) expect(p.startsWith("/"), `${f.bundle}:${f.path} ${p}`).toBe(true);
			if (s.source === "none") expect(s.count).toBe(0);
		}
	});

	it("decodes legacy NV item numbers as uint16 values", () => {
		let seen = 0;
		for (const f of files) {
			for (const n of pri(f.bundle, f.path).nvItems) {
				seen++;
				expect(Number.isInteger(n)).toBe(true);
				expect(n).toBeGreaterThanOrEqual(0);
				expect(n).toBeLessThanOrEqual(0xffff);
			}
		}
		expect(seen).toBeGreaterThan(1000);
	});

	it("never lets a paired value tag leak into the unknown bucket", () => {
		const valueTags = new Set(["9fa712", "9fa70f", "9fae71", "9fa70d", "9fae73"]);
		for (const f of files) {
			for (const u of pri(f.bundle, f.path).unknown) {
				expect(valueTags.has(u.tag), `${f.bundle}:${f.path} ${u.tag}`).toBe(false);
			}
		}
	});

	it("reaches the same result through decodeFile as through decodePri directly", () => {
		const d = decodeFile(bundle("carrier-cw-pa.ipcc"), "overrides_D10_D11.der.pri");
		expect(d.kind).toBe("pri-der");
		expect(decodedPri(d)).toBeDefined();
		expect(decodedPri(d)).toEqual(pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri"));
		const g = decodeFile(bundle("carrier-cw-wi.ipcc"), "global_setting_C.der.gri");
		expect(defined(decodedPri(g)).kind).toBe("der.gri");
	});
});

describe("decodePri: headers", () => {
	it("lifts Carrier ID, PRI Revision and PRI Name out of the named pairs", () => {
		const d = pri("carrier-att.ipcc", "overrides_D321_D331_N841.der.pri");
		expect(d.header).toEqual({
			"Carrier ID": "",
			"PRI Revision": "0.0.26",
			"PRI Name": "ATT_US",
		});
	});

	it("uses GRI Revision for .der.gri files and never emits PRI Revision there", () => {
		for (const f of allDerFiles().filter((x) => x.path.endsWith(".der.gri"))) {
			const h = pri(f.bundle, f.path).header;
			expect(Object.keys(h)).toEqual(["GRI Revision"]);
			expect(h["GRI Revision"]).toMatch(/^\d+\.\d+\.\d+$/);
		}
		expect(pri("carrier-cw-wi.ipcc", "global_setting_B.der.gri").header["GRI Revision"]).toBe("12.1.9");
		expect(pri("carrier-cw-wi.ipcc", "global_setting_G.der.gri").header["GRI Revision"]).toBe("2.1.2");
	});

	it("renders an empty header value as the empty string rather than (empty)", () => {
		for (const f of allDerFiles()) {
			const h = pri(f.bundle, f.path).header;
			for (const v of Object.values(h)) expect(v).not.toBe("(empty)");
		}
		expect(pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri").header["Carrier ID"]).toBe("");
	});

	it("keeps header keys out of `named` — no fixture file has any named settings", () => {
		for (const f of allDerFiles()) {
			const d = pri(f.bundle, f.path);
			expect(d.named, `${f.bundle}:${f.path}`).toEqual([]);
			for (const k of Object.keys(d.header)) {
				expect(["Carrier ID", "PRI Revision", "PRI Name", "GRI Revision"]).toContain(k);
			}
		}
	});

	it("routes a non-header name/value pair into `named` (hand-built)", () => {
		const d = decodePri(
			cat(
				tlv("9fa711", S("Preferred Mode")),
				tlv("9fa712", S("GWL")),
				tlv("9fa70e", S("NAM Name")),
				tlv("9fa70f", S("Airtel")),
				tlv("9fae70", S("PRI Name")),
				tlv("9fae71", S("Test_US")),
			),
		);
		expect(d.header).toEqual({ "PRI Name": "Test_US" });
		expect(d.named).toEqual([
			{ name: "Preferred Mode", value: expect.objectContaining({ kind: "string", text: "GWL" }) },
			{ name: "NAM Name", value: expect.objectContaining({ kind: "string", text: "Airtel" }) },
		]);
		expect(d.unknown).toEqual([]);
	});

	it("yields an empty value for a dangling name with no following value tag", () => {
		const d = decodePri(tlv("9fa711", S("Orphan")));
		expect(d.named).toEqual([{ name: "Orphan", value: { kind: "empty", text: "(empty)", hex: "", len: 0 } }]);
	});
});

describe("decodePri: pair families", () => {
	it("decodes a classic-format file into /nv/item_files EFS paths under tag 9fa70c", () => {
		const d = pri("carrier-att.ipcc", "overrides_D63_D64_D16_D17.der.pri");
		expect(d.efs.length).toBe(70);
		expect([...new Set(d.efs.map((e) => e.tag))]).toEqual(["9fa70c"]);
		expect(d.efs.every((e) => e.path.startsWith("/"))).toBe(true);
		expect(d.efs.some((e) => e.path.startsWith("/nv/item_files/"))).toBe(true);
	});

	it("decodes the long-form Qualcomm path tag as the same EFS family", () => {
		const d = pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri");
		expect([...new Set(d.efs.map((e) => e.tag))]).toEqual(["9f98808080808080a70c"]);
		expect(d.efs.map((e) => [e.path, e.value.text])).toEqual([
			["/nv/item_files/jcdma/jcdma_mode", "0"],
			["/nv/item_files/ims/IMS_enable", "2"],
			["/nv/item_files/modem/mmode/sms_domain_pref", "0"],
			["/nv/item_files/modem/mmode/voice_domain_pref", "0"],
			["/nv/item_files/modem/nas/nas_srvcc_support", "1"],
			["/nv/item_files/modem/nas/lte_nas_ignore_mt_csfb_during_volte_call", "1"],
			["/mav/mav_police_pri_mode_pref_mask", "28"],
		]);
	});

	it("decodes an Intel-dialect file into %u:dyn_cps.* paths under tag 9fae72", () => {
		const d = pri("carrier-att.ipcc", "overrides_D321_D331_N841.der.pri");
		expect(d.efs.length).toBe(53);
		expect([...new Set(d.efs.map((e) => e.tag))]).toEqual(["9fae72"]);
		expect(d.efs.every((e) => e.path.startsWith("%u:dyn_"))).toBe(true);
		expect(d.efs[0]).toMatchObject({
			path: "%u:dyn_cps.dam.support",
			tag: "9fae72",
			value: { kind: "int", text: "1", int: 1, hex: "01000000", len: 4 },
			name: "dyn_cps.dam.support",
			confidence: "med",
		});
		expect(d.efs[0]?.meaning).toContain("Intel-dialect NVM field");
		// D321/D331/N841 are iPhone XS/XR models, which have Intel modems.
		expect(d.dialect).toBe("intel");
	});

	it("never mixes the classic and CPS pair families within one file", () => {
		let classic = 0;
		let cps = 0;
		for (const f of allDerFiles()) {
			const kinds = new Set(pri(f.bundle, f.path).efs.map((e) => e.tag));
			const isClassic = kinds.has("9fa70c") || kinds.has("9f98808080808080a70c");
			const isCps = kinds.has("9fae72");
			expect(isClassic && isCps, `${f.bundle}:${f.path}`).toBe(false);
			if (isClassic) classic++;
			if (isCps) cps++;
		}
		expect(classic).toBe(26);
		expect(cps).toBe(15);
	});

	it("decodes the embedded policyman carrier policy document as XML", () => {
		const d = pri("carrier-att.ipcc", "overrides_D63_D64_D16_D17.der.pri");
		const policy = defined(d.efs.find((e) => e.path === "/policyman/carrier_policy.xml"));
		expect(policy).toBeDefined();
		expect(policy.value.kind).toBe("xml");
		expect(policy.value.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		expect(policy.value.text).toContain("Carrier policy");
	});

	it("finds the SUPL H-SLP hostname blob in the Verizon files", () => {
		const d = pri("carrier-verizon.ipcc", "overrides_D49.der.pri");
		expect(d.unknown.find((u) => u.tag === "9fa45f")).toBeUndefined();
		const nv = defined(d.nv.find((x) => x.item === 4703));
		expect(nv.tag).toBe("9fa45f");
		expect(nv.value).toMatchObject({ kind: "string", text: "e-slp.lte.911.nj.myvzw.com:7275", len: 128 });
	});

	it("yields an empty value for a dangling path with no following value tag", () => {
		const d = decodePri(tlv("9fa70c", S("/x/y")));
		expect(d.efs).toEqual([
			{ path: "/x/y", tag: "9fa70c", value: { kind: "empty", text: "(empty)", hex: "", len: 0 } },
		]);
	});
});

describe("decodePri: feature groups", () => {
	it("names all eight standard groups plus the unnamed 9f83e453", () => {
		const d = pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri");
		expect(d.featureGroups.length).toBe(8);
		expect(d.featureGroups.map((g) => g.name).toSorted()).toEqual([
			"CDMA 1X Feature Group",
			"Call Manager Feature Group",
			"Data Service Feature Group",
			"EVDO Feature Group",
			"OMA Feature Group",
			"System Determination Feature Group",
			"UIM Service Feature Group",
			"Wireless Messaging Feature Group",
		]);
		const att = pri("carrier-att.ipcc", "overrides_D49.der.pri");
		const unnamed = defined(att.featureGroups.find((g) => g.tag === "9f83e453"));
		expect(unnamed.name).toBe("Feature Group (unnamed, tag 9f83e453)");
		expect(unnamed.bits).toEqual([3]);
	});

	it("reports set bits as byte indices of non-zero bytes", () => {
		const d = pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri");
		const cm = defined(d.featureGroups.find((g) => g.name === "Call Manager Feature Group"));
		expect(cm.tag).toBe("9f83e43c");
		expect(cm.bits).toEqual([8, 10]);
		expect(cm.hex).toBe("00000000000000000100010000000000000000000000000000");
		// Every other group in this file is all zeroes.
		for (const g of d.featureGroups) {
			if (g !== cm) expect(g.bits, g.name).toEqual([]);
		}
	});

	it("uses a different Call Manager bitfield in the AT&T bundle", () => {
		const cm = defined(
			pri("carrier-att.ipcc", "overrides_D49.der.pri").featureGroups.find((g) => g.tag === "9f83e43c"),
		);
		expect(cm.bits).toEqual([12, 20]);
	});

	it("ignores a feature-group tag whose value is not exactly 25 bytes", () => {
		const d = decodePri(tlv("9f83e43c", new Uint8Array(24)));
		expect(d.featureGroups).toEqual([]);
		expect(d.unknown.map((u) => u.tag)).toEqual(["9f83e43c"]);
	});

	it("marks every byte index of a fully-set bitfield (hand-built)", () => {
		const d = decodePri(tlv("9f83e439", new Uint8Array(25).fill(0xff)));
		expect(d.featureGroups[0]?.bits).toEqual(Array.from({ length: 25 }, (_, i) => i));
		expect(d.featureGroups[0]?.name).toBe("CDMA 1X Feature Group");
	});
});

describe("decodePri: NV path schema index", () => {
	it("keeps the raw schema list in `schema`, separate from the assigned `efs` overrides", () => {
		const d = pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri");
		expect(d.schema.source).toBe("raw");
		expect(d.schema.count).toBe(193);
		expect(d.schema.paths.length).toBe(193);
		// The index names 193 paths, but only 7 of them carry a value.
		expect(d.efs.length).toBe(7);
		expect(d.schema.paths[0]).toBe("/nv/item_files/jcdma/jcdma_mode");
		expect(d.schema.paths.at(-1)).toBe("/nv/item_files/modem/lte/rrc/srs_common_validation_disable");
		// A schema entry is a path only: nothing in `schema` carries a decoded value.
		for (const p of d.schema.paths) expect(typeof p).toBe("string");
	});

	it("lists every assigned /nv override path in the schema index too", () => {
		for (const f of allDerFiles()) {
			const d = pri(f.bundle, f.path);
			if (d.schema.count === 0) continue;
			const known = new Set(d.schema.paths);
			for (const e of d.efs) {
				if (!e.path.startsWith("/nv/")) continue;
				expect(known.has(e.path), `${f.bundle}:${f.path} ${e.path}`).toBe(true);
			}
		}
	});

	it("splits a hand-built NUL-separated raw list and drops empty entries", () => {
		const d = decodePri(tlv("9fa709", S("/a/b\0/c/d\0\0")));
		expect(d.schema).toEqual({ source: "raw", count: 2, paths: ["/a/b", "/c/d"] });
	});

	it("reports source none when no schema tag is present", () => {
		expect(decodePri(new Uint8Array()).schema).toEqual({ source: "none", count: 0, paths: [] });
		expect(pri("carrier-att.ipcc", "overrides_D321_D331_N841.der.pri").schema).toEqual({
			source: "none",
			count: 0,
			paths: [],
		});
	});

	it("reports a corrupt MAVZ blob as an error, without throwing", () => {
		const corrupt = cat(S("MAVZ"), B(0x00, 0x01, 0x00, 0x00), B(0xde, 0xad, 0xbe, 0xef, 0, 1, 2));
		const d = decodePri(tlv("9fa709", corrupt));
		expect(d.schema).toEqual({ source: "none", count: 0, paths: [] });
		expect(d.errors).toEqual(["MAVZ schema index: invalid zlib data"]);
	});

	it("reports a blob that is neither MAVZ nor a / path list as source none", () => {
		const d = decodePri(tlv("9fa709", B(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)));
		expect(d.schema).toEqual({ source: "none", count: 0, paths: [] });
	});

	it("does not treat a truncated MAVZ magic (under 9 bytes) as compressed", () => {
		expect(decodePri(tlv("9fa709", S("MAVZ123"))).schema).toEqual({
			source: "none",
			count: 0,
			paths: [],
		});
	});

	it("recognises the MAVZ container and its little-endian uncompressed-size header", () => {
		// Ground truth for the next test.
		const leaf = defined(
			leavesOf(raw("carrier-att.ipcc", "overrides_D73_D74_D27_D28.der.pri")).find((l) => l.tag === "9fa709"),
		);
		expect(new TextDecoder().decode(leaf.value.subarray(0, 4))).toBe("MAVZ");
		const declared = u32le(leaf.value, 4);
		expect(declared).toBe(15248);
		// Byte 8 onward is a zlib stream (0x78 0x9c), not a bare deflate stream.
		expect(leaf.value[8]).toBe(0x78);
		expect(leaf.value[9]).toBe(0x9c);
		const inflated = unzlibSync(leaf.value.subarray(8));
		expect(inflated.length).toBe(declared);
		const paths = new TextDecoder().decode(inflated).split("\0").filter(Boolean);
		expect(paths.length).toBe(292);
		expect(paths[0]).toBe("/nv/item_files/modem/nas/lte_nas_temp_fplmn_backoff_time");
		expect(paths.every((p) => p.startsWith("/"))).toBe(true);
	});

	it("inflates a MAVZ schema blob into its path list", () => {
		const d = pri("carrier-att.ipcc", "overrides_D73_D74_D27_D28.der.pri");
		expect(d.schema.source).toBe("MAVZ");
		expect(d.schema.count).toBe(292);
		expect(d.schema.paths[0]).toBe("/nv/item_files/modem/nas/lte_nas_temp_fplmn_backoff_time");
		expect(d.schema.paths.every((p) => p.startsWith("/"))).toBe(true);
	});

	it("inflates the largest MAVZ schema blob in the corpus", () => {
		const d = pri("carrier-verizon.ipcc", "overrides_V53_V54_V57.der.pri");
		expect(d.schema.source).toBe("MAVZ");
		expect(d.schema.count).toBe(357);
	});

	it("inflates every MAVZ file in the corpus into a non-empty path list", () => {
		const mavz = allDerFiles().filter((f) => pri(f.bundle, f.path).schema.source === "MAVZ");
		expect(mavz.length).toBe(6);
		for (const f of mavz) {
			const schema = pri(f.bundle, f.path).schema;
			expect(schema.count, `${f.bundle}/${f.path}`).toBeGreaterThan(50);
			expect(schema.paths.length).toBe(schema.count);
			for (const path of schema.paths) expect(path.startsWith("/")).toBe(true);
		}
	});

	it("matches the MAVZ uncompressed-size header against what it inflated", () => {
		const leaf = defined(
			leavesOf(raw("carrier-att.ipcc", "overrides_D73_D74_D27_D28.der.pri")).find((l) => l.tag === "9fa709"),
		);
		const declared = u32le(leaf.value, 4);
		const schema = pri("carrier-att.ipcc", "overrides_D73_D74_D27_D28.der.pri").schema;
		// NUL-separated: the joined length plus one terminator per path.
		expect(schema.paths.join("").length + schema.count).toBe(declared);
	});
});

describe("decodePri: legacy NV item list", () => {
	it("decodes the uint16 little-endian item numbers of a real file", () => {
		const d = pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri");
		expect(d.nvItems.length).toBe(126);
		expect(d.nvItems.slice(0, 6)).toEqual([259, 255, 176, 177, 20, 21]);
		const leaf = defined(
			leavesOf(raw("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri")).find((l) => l.tag === "9fa708"),
		);
		expect(leaf.value.length).toBe(d.nvItems.length * 2);
	});

	it("decodes a hand-built item list and drops a trailing odd byte", () => {
		expect(decodePri(tlv("9fa708", B(1, 0, 2, 0, 3))).nvItems).toEqual([1, 2]);
		expect(decodePri(tlv("9fa708", B(0xff, 0xff, 0x00, 0x01))).nvItems).toEqual([65535, 256]);
		expect(decodePri(tlv("9fa708", new Uint8Array())).nvItems).toEqual([]);
	});

	it("keeps the NV item list out of efs and unknown", () => {
		const d = decodePri(tlv("9fa708", B(1, 0)));
		expect(d.efs).toEqual([]);
		expect(d.unknown).toEqual([]);
	});
});

describe("decodePri: unidentified tags", () => {
	it("aggregates unknown tags instead of dropping them", () => {
		const d = pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri");
		expect(d.unknown.map((u) => u.tag)).toEqual(["9fa710"]);
		expect(d.unknown[0]?.count).toBe(1);
	});

	it("counts repeats of the same tag and keeps the first decoded sample", () => {
		const d = decodePri(
			cat(tlv("9fa710", B(1)), tlv("9fa710", B(2)), tlv("9fa710", B(3)), tlv("9f8e67", B(9))),
		);
		expect(d.unknown).toEqual([
			{ tag: "9fa710", len: 1, hex: "01", int: 1, note: PRI_TAGS["9fa710"]?.note, count: 3 },
			{ tag: "9f8e67", len: 1, hex: "09", int: 9, count: 1 },
		]);
	});

	it("sorts the unknown bucket by descending count", () => {
		const d = decodePri(cat(tlv("9f8e67", B(1)), tlv("9fa710", B(1)), tlv("9fa710", B(2))));
		expect(d.unknown.map((u) => [u.tag, u.count])).toEqual([
			["9fa710", 2],
			["9f8e67", 1],
		]);
	});

	it("leaves only the 9fa710 blob unconsumed in the fixture corpus; every other leftover is an NV value", () => {
		let nv = 0;
		for (const f of allDerFiles()) {
			const d = pri(f.bundle, f.path);
			for (const u of d.unknown) {
				expect(u.tag, f.path).toBe("9fa710");
				expect(u.note).toBeTruthy();
			}
			for (const x of d.nv) {
				expect(x.item, `${f.path} ${x.tag}`).toBe(tagNumber(x.tag));
				expect(d.nvItems, `${f.path} ${x.tag}`).toContain(x.item);
				nv++;
			}
		}
		expect(nv).toBeGreaterThan(100);
	});

	it("gives the 9fa710 blob tag its own note", () => {
		const u = decodePri(tlv("9fa710", hex("b200200021"))).unknown[0];
		expect(u?.note).toBeTruthy();
		expect(u?.tag).toBe("9fa710");
	});

	it("truncates the stored hex sample to 256 characters", () => {
		const big = new Uint8Array(400).fill(0xab);
		const u = decodePri(tlv("9f8e67", big)).unknown[0];
		expect(u?.len).toBe(400);
		expect(u?.hex.length).toBe(256);
	});

	it("carries int for scalar unknowns and ascii for printable ones", () => {
		const d = decodePri(cat(tlv("9f8e67", hex("ffbe")), tlv("9f8e66", S("some-ascii-pattern"))));
		const scalar = defined(d.unknown.find((u) => u.tag === "9f8e67"));
		expect(scalar.int).toBe(48895);
		expect(scalar.ascii).toBeUndefined();
		const ascii = defined(d.unknown.find((u) => u.tag === "9f8e66"));
		expect(ascii.ascii).toBe("some-ascii-pattern");
		expect(ascii.int).toBeUndefined();
	});

	it("leaves a tag that is neither in the table nor in the NV list without a note", () => {
		const d = decodePri(cat(tlv("9fa708", B(1, 0)), tlv("9f8e67", B(1))));
		expect(d.unknown).toEqual([{ tag: "9f8e67", len: 1, hex: "01", int: 1, note: undefined, count: 1 }]);
		expect(d.nv).toEqual([]);
	});
});

describe("cross-check against the plaintext .pri plists shipped alongside", () => {
	const GROUND_TRUTH = [
		{
			bundle: "carrier-cw-pa.ipcc",
			plain: "overrides_N69.pri",
			binaries: [
				"overrides_D10_D11.der.pri",
				"overrides_D20_D21.der.pri",
				"overrides_D22.der.pri",
				"overrides_N66_N71.der.pri",
			],
		},
		{
			bundle: "carrier-cw-pa.ipcc",
			plain: "overrides_N56_N61.pri",
			binaries: ["overrides_D10_D11.der.pri", "overrides_N66_N71.der.pri"],
		},
		{
			bundle: "carrier-airtel-in.ipcc",
			plain: "overrides_N69.pri",
			binaries: ["overrides_D10_D11.der.pri", "overrides_D20_D21_D22.der.pri", "overrides_N66_N71.der.pri"],
		},
	];

	const plainPlist = (b: string, p: string) => record(parsePlist(raw(b, p)));

	it("finds a plaintext plist .pri with a Carrier Configuration Management dict", () => {
		for (const g of GROUND_TRUTH) {
			const p = plainPlist(g.bundle, g.plain);
			const ccm = p["Carrier Configuration Management"];
			expect(ccm, `${g.bundle}:${g.plain}`).toBeTruthy();
			expect(Object.keys(record(ccm)).length).toBe(8);
			for (const arr of Object.values(record(ccm))) {
				expect(Array.isArray(arr)).toBe(true);
				expect(array(arr).length).toBe(25);
				for (const v of array(arr)) expect(typeof v).toBe("boolean");
			}
		}
	});

	it("names the same eight feature groups the plaintext plist names", () => {
		for (const g of GROUND_TRUTH) {
			const truth = Object.keys(record(plainPlist(g.bundle, g.plain)["Carrier Configuration Management"]));
			for (const bin of g.binaries) {
				const names = pri(g.bundle, bin).featureGroups.map((x) => x.name);
				expect([...names].toSorted(), `${g.bundle}:${bin}`).toEqual([...truth].toSorted());
			}
		}
	});

	it("computes exactly the set bits the plaintext boolean arrays declare", () => {
		let checked = 0;
		for (const g of GROUND_TRUTH) {
			const ccm = record(plainPlist(g.bundle, g.plain)["Carrier Configuration Management"]);
			for (const bin of g.binaries) {
				for (const group of pri(g.bundle, bin).featureGroups) {
					const arr = array(ccm[group.name]);
					const expected = arr.map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
					expect(group.bits, `${g.bundle}:${bin} ${group.name}`).toEqual(expected);
					checked++;
				}
			}
		}
		expect(checked).toBe(72);
	});

	it("finds the Call Manager bits 8 and 10 in both the plist and the binary", () => {
		const ccm = record(
			plainPlist("carrier-cw-pa.ipcc", "overrides_N69.pri")["Carrier Configuration Management"],
		);
		const arr = array(ccm["Call Manager Feature Group"]);
		expect(arr.map((on, i) => (on ? i : -1)).filter((i) => i >= 0)).toEqual([8, 10]);
		const group = defined(
			pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri").featureGroups.find(
				(g) => g.name === "Call Manager Feature Group",
			),
		);
		expect(group.bits).toEqual([8, 10]);
	});

	it("matches the plaintext Maverick dict against the decoded binary header", () => {
		for (const g of GROUND_TRUTH) {
			const mav = record(plainPlist(g.bundle, g.plain)["Maverick"]);
			for (const bin of g.binaries) {
				const h = pri(g.bundle, bin).header;
				expect(h["PRI Revision"], `${g.bundle}:${bin}`).toBe(mav["PRI Revision"]);
				expect(h["Carrier ID"]).toBe(mav["Carrier ID"]);
			}
		}
		expect(pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri").header["PRI Revision"]).toBe("0.1.161");
		expect(pri("carrier-airtel-in.ipcc", "overrides_D10_D11.der.pri").header["PRI Revision"]).toBe("0.1.168");
	});

	it("matches the plaintext IMS/LTE/JCDMA settings against the decoded EFS values", () => {
		// Path -> [plist section, plist key, plist value rendered the way decodeValue would]
		const MAP: Array<[string, string, string, (v: unknown) => string]> = [
			["/nv/item_files/ims/IMS_enable", "IMS", "IMS Feature Enable", String],
			["/nv/item_files/jcdma/jcdma_mode", "JCDMA", "Enable JCDMA", (v) => (v ? "1" : "0")],
			["/nv/item_files/modem/nas/nas_srvcc_support", "LTE", "SRVCC Support", (v) => (v ? "1" : "0")],
			[
				"/nv/item_files/modem/nas/lte_nas_ignore_mt_csfb_during_volte_call",
				"LTE",
				"Ignore MT CSFB in VoLTE Call",
				(v) => (v ? "1" : "0"),
			],
			[
				"/nv/item_files/modem/mmode/voice_domain_pref",
				"LTE",
				"Voice Domain Preference",
				(v) => (v === "CS Voice Only" ? "0" : "?"),
			],
		];
		let checked = 0;
		for (const g of GROUND_TRUTH) {
			const p = plainPlist(g.bundle, g.plain);
			for (const bin of g.binaries) {
				const efs = new Map(pri(g.bundle, bin).efs.map((e) => [e.path, e.value]));
				for (const [path, section, key, render] of MAP) {
					const value = efs.get(path);
					const sectionDict = p[section];
					const truth = isRecord(sectionDict) ? sectionDict[key] : undefined;
					if (!value || truth === undefined) continue;
					expect(value.text, `${g.bundle}:${bin} ${path}`).toBe(render(truth));
					checked++;
				}
			}
		}
		expect(checked).toBe(45);
	});

	it("matches the plaintext WCDMA band-class mask against NV 946 (tag 9f8732)", () => {
		let checked = 0;
		for (const g of GROUND_TRUTH) {
			const truth = record(plainPlist(g.bundle, g.plain)["WCDMA"])["Band Class Pref b16-b31"];
			for (const bin of g.binaries) {
				const d = pri(g.bundle, bin);
				const u = d.nv.find((x) => x.item === 946);
				if (!u) continue;
				expect(u.tag).toBe("9f8732");
				expect(String(intOf(u.value)), `${g.bundle}:${bin}`).toBe(String(truth));
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(0);
	});

	it("matches the plaintext Preferred Mode, IPv6 and ANITE GCF keys against NV 10, 1896 and 947", () => {
		let checked = 0;
		for (const g of GROUND_TRUTH) {
			const p = plainPlist(g.bundle, g.plain);
			for (const bin of g.binaries) {
				const nv = new Map(pri(g.bundle, bin).nv.map((x) => [x.item, x]));
				expect(defined(nv.get(10)).label, bin).toBe(record(p["Feature Settings"])["Preferred Mode"]);
				expect(intOf(nv.get(947)?.value)).toBe(record(p["WCDMA"])["ANITE GCF"] ? 1 : 0);
				const v6 = nv.get(1896);
				if (v6)
					expect(intOf(v6.value), `${g.bundle}:${bin}`).toBe(
						record(p["Data Parameters"])["Enable IPv6"] ? 1 : 0,
					);
				checked++;
			}
		}
		expect(checked).toBe(9);
	});

	it("packs the PRI Revision header into NV 62005 as [major, minor, patch, 0]", () => {
		for (const f of allDerFiles()) {
			const d = pri(f.bundle, f.path);
			const rev = d.nv.find((x) => x.item === 62005);
			if (!rev) continue;
			expect(rev.label, `${f.bundle}:${f.path}`).toBe(d.header["PRI Revision"]);
		}
	});
});

describe("the %qu[N] quoted-string family", () => {
	const G = () => pri("carrier-cw-wi.ipcc", "global_setting_G.der.gri");

	it("decodes a %qu[N] path whose value exceeds the 8-byte window as text", () => {
		const e = defined(
			G().efs.find((x) => x.path === "%qu[30]:dyn_cps_gri.lte_regulatory_info.na_table[0][1]"),
		);
		expect(e.value.kind).toBe("string");
		expect(e.value.text).toBe("lte_band_mask_1_32:0x3101385a");
		const nine = defined(G().efs.find((x) => x.path.startsWith("%qu[9]:")));
		expect(nine.value.kind).toBe("string");
		expect(nine.value.text).toBe("402:3-78");
	});

	// "%qu[N]:" values are NUL-padded strings, even when N <= 8 would fit an integer.
	it("decodes a NUL-padded %qu[8] quoted string as text, not as an integer", () => {
		const e = defined(
			G().efs.find((x) => x.path === "%qu[8]:dyn_cps_gri.lte_regulatory_info.na_table[0][0]"),
		);
		expect(e.value.hex).toBe("6d63633a33303200");
		expect(e.value.kind).toBe("string");
		expect(e.value.text).toBe("mcc:302");
	});

	it("decodes every %qu[N] path in the corpus as text", () => {
		let wrong = 0;
		for (const f of allDerFiles()) {
			for (const e of pri(f.bundle, f.path).efs) {
				if (e.path.startsWith("%qu[") && e.value.kind !== "string") wrong++;
			}
		}
		expect(wrong).toBe(0);
	});

	it("decodes the 281 short %qu[N] values that used to read as integers", () => {
		const quoted = G().efs.filter((e) => e.path.startsWith("%qu["));
		expect(quoted.length).toBeGreaterThanOrEqual(281);
		expect(quoted.every((e) => e.value.kind === "string")).toBe(true);
	});

	it("decodes the %u: scalar family correctly, so the heuristic is right there", () => {
		const d = pri("carrier-cw-wi.ipcc", "global_setting_B.der.gri");
		const us = d.efs.filter((e) => e.path.startsWith("%u:"));
		expect(us.length).toBeGreaterThan(1000);
		for (const e of us) expect(e.value.kind, e.path).toBe("int");
	});
});

describe("malformed and hostile input", () => {
	it("returns an empty decode for empty input", () => {
		const d = decodePri(new Uint8Array());
		expect(d.errors).toEqual([]);
		expect(d.leafCount).toBe(0);
		expect(d.header).toEqual({});
		expect(d.named).toEqual([]);
		expect(d.efs).toEqual([]);
		expect(d.featureGroups).toEqual([]);
		expect(d.nvItems).toEqual([]);
		expect(d.unknown).toEqual([]);
	});

	it("survives every truncation offset of a real classic file", () => {
		const bytes = raw("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri");
		for (let i = 0; i <= bytes.length; i++) {
			const d = decodePri(bytes.subarray(0, i));
			if (i === 0 || i === bytes.length) expect(d.errors, `offset ${i}`).toEqual([]);
			else expect(d.errors, `offset ${i}`).toEqual([expect.stringMatching(/^DER stops at byte \d+: /)]);
			expect(d.leafCount).toBeGreaterThanOrEqual(0);
			expect(d.schema.count).toBe(d.schema.paths.length);
		}
	});

	it("decodes single-byte and two-byte garbage without error", () => {
		for (let b = 0; b < 256; b++) {
			expect(() => decodePri(B(b))).not.toThrow();
			expect(() => decodePri(B(b, 0xff))).not.toThrow();
		}
	});

	it("handles a length field that overruns the buffer", () => {
		expect(decodePri(B(0x31, 0x7f, 0x00)).leafCount).toBe(0);
		expect(decodePri(cat(tlv("9fa711", S("Carrier ID")), B(0x9f, 0xa7, 0x12, 0x40))).leafCount).toBe(1);
		expect(decodePri(B(0x04, 0x84, 0x7f, 0xff, 0xff, 0xff, 0x01)).leafCount).toBe(0);
	});

	it("handles an unsupported long-form length of more than four bytes", () => {
		const d = decodePri(
			cat(tlv("9fa711", S("PRI Name")), B(0x9f, 0xa7, 0x12, 0x88, 0, 0, 0, 0, 0, 0, 0, 1, 0x41)),
		);
		expect(d.errors).toEqual(["DER stops at byte 12: ASN.1 length too long"]);
		// Parsing stops at the bad length, so the name is left dangling with no value.
		expect(d.header).toEqual({ "PRI Name": "" });
	});

	it("handles a tag whose high-tag-number continuation runs off the end", () => {
		for (const buf of [
			B(0x9f),
			B(0x9f, 0x80),
			B(0x9f, 0x80, 0x80),
			B(0x9f, 0x98, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80),
			cat(tlv("9fa70c", S("/a/b")), B(0x9f, 0x81, 0x81, 0x81)),
		]) {
			const d = decodePri(buf);
			expect(d.errors.length).toBe(1);
			expect(Number.isFinite(d.leafCount)).toBe(true);
		}
	});

	it("does not hang or throw on pseudo-random bytes", () => {
		let seed = 0x2545f491;
		const next = () => {
			seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
			return (seed >>> 16) & 0xff;
		};
		for (let k = 0; k < 500; k++) {
			const buf = new Uint8Array(512);
			for (let i = 0; i < buf.length; i++) buf[i] = next();
			const d = decodePri(buf);
			expect(d.schema.count).toBe(d.schema.paths.length);
			for (const g of d.featureGroups) expect(g.total).toBe(25);
		}
	});

	it("does not hang or throw on single-byte mutations of a real file", () => {
		const original = raw("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri");
		for (let i = 0; i < original.length; i += 29) {
			for (const flip of [0x00, 0xff, 0x80]) {
				const buf = original.slice();
				buf[i] = flip;
				const d = decodePri(buf);
				for (const e of d.efs) expect(e.value.len).toBe(e.value.hex.length / 2);
			}
		}
	});

	it("does not hang on a run of nested constructed headers", () => {
		let buf: Uint8Array = B(0x04, 0x00);
		for (let i = 0; i < 60; i++) buf = wrapShort(0x30, buf);
		expect(() => decodePri(buf)).not.toThrow();
	});

	it("does not hang on a long run of zero-length elements", () => {
		const buf = new Uint8Array(20_000); // 10_000 leaves of tag 0x00, length 0
		const d = decodePri(buf);
		expect(d.leafCount).toBe(10_000);
		expect(d.unknown).toEqual([
			{ tag: "00", len: 0, hex: "", int: undefined, ascii: undefined, note: undefined, count: 10_000 },
		]);
	});
});

describe("nvTag and tagNumber", () => {
	it("round-trips nvTag and tagNumber for low, 2-byte and 3-byte tag numbers", () => {
		expect(nvTag(10)).toBe("8a");
		expect(nvTag(946)).toBe("9f8732");
		expect(nvTag(62005)).toBe("9f83e435");
		expect(tagNumber("9fa70c")).toBe(5004);
		expect(tagNumber("9f98808080808080a70c")).toBeUndefined(); // exceeds 2^53
		expect(tagNumber("")).toBeUndefined();
		for (const k of [1, 30, 31, 127, 128, 16383, 16384, 65535]) expect(tagNumber(nvTag(k))).toBe(k);
	});
});

describe("dialect", () => {
	it("tells Qualcomm files from Intel / C1 ones by their tags", () => {
		const qc = decodePri(new Uint8Array(readFileSync(join(here, "fixtures", "pri/altice.der.pri"))));
		expect(qc.dialect).toBe("qualcomm");
		// 9fae70/9fae71 name/value pairs are the Intel dialect Apple C1 kept: [6000] "PRI Name", [6001] value.
		const c1 = new Uint8Array([
			0x31,
			0x13,
			0x80,
			0x11,
			0x30,
			0x0f,
			0x9f,
			0xae,
			0x70,
			0x08,
			...new TextEncoder().encode("PRI Name"),
			0x9f,
			0xae,
			0x71,
			0x01,
			0x41,
		]);
		expect(decodePri(c1, "der.gri").dialect).toBe("intel");
	});
});

describe("decodePri: CCM feature flags", () => {
	it("exposes 25 independent 0/1 flags per group, none of them named", () => {
		const cm = defined(
			pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri").featureGroups.find((g) => g.nv === 62012),
		);
		expect(cm.flags.length).toBe(25);
		expect(cm.boolean).toBe(true);
		expect(cm.confidence).toBe("high");
		expect(cm.flags.filter((f) => f.set).map((f) => f.index)).toEqual([8, 10]);
		for (const f of cm.flags) {
			expect(f.value === 0 || f.value === 1).toBe(true);
			expect(f.name).toBeUndefined();
			expect(f.confidence).toBe("unknown");
		}
	});

	it("flags a group whose bytes are not all 0/1 as non-boolean", () => {
		const g = decodePri(tlv("9f83e439", new Uint8Array(25).fill(0xff))).featureGroups[0];
		expect(g?.boolean).toBe(false);
		expect(g?.flags[0]).toEqual({ index: 0, value: 255, set: true, confidence: "unknown" });
	});

	it("finds only 0/1 bytes across every group in the fixture corpus", () => {
		for (const f of allDerFiles())
			for (const g of pri(f.bundle, f.path).featureGroups) expect(g.boolean).toBe(true);
	});
});

describe("decodePri: legacy NV values", () => {
	it("decodes the NV-value tags of a classic file with names and labels", () => {
		const d = pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri");
		expect(d.nv.map((x) => [x.item, x.tag, x.value.text, x.label])).toEqual([
			[
				946,
				"9f8732",
				"48895",
				"GSM 450, GSM 480, GSM 750, GSM 850, GSM railways 900, GSM PCS 1900, WCDMA B1 2100, WCDMA B2 1900, WCDMA B4 1700, WCDMA B5 850, WCDMA B6 800, bit 12, bit 13, bit 15",
			],
			[62005, "9f83e435", "10551552", "0.1.161"],
			[10, "8a", "31", "GWL"],
			[947, "9f8733", "0", "Off"],
			[62025, "9f83e449", "0", "Off"],
		]);
		expect(d.nv[2]).toMatchObject({ name: "Mode preference", confidence: "high" });
	});

	it("treats any tag whose number the file lists in 9fa708 as that NV item's value", () => {
		const d = decodePri(cat(tlv("9f9b4d", B(30)), tlv("9fa708", B(0xcd, 0x0d))));
		expect(nvTag(3533)).toBe("9f9b4d");
		expect(d.nv).toEqual([
			{
				item: 3533,
				tag: "9f9b4d",
				name: "SMS MO Retry Interval",
				confidence: "med",
				value: { kind: "int", text: "30", int: 30, hex: "1e", len: 1 },
			},
		]);
		expect(d.unknown).toEqual([]);
	});

	it("marks which listed items carry a value in nvListed", () => {
		const d = pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri");
		expect(d.nvListed.length).toBe(d.nvItems.length);
		expect(d.nvListed.find((x) => x.item === 946)).toEqual({
			item: 946,
			name: "Band preference bits 16-31",
			set: true,
		});
		expect(defined(d.nvListed.find((x) => x.item === 62012)).set).toBe(true); // a CCM group
		expect(d.nvListed.find((x) => x.item === 176)).toEqual({ item: 176, name: "IMSI MCC", set: false });
	});

	it("annotates EFS entries with the NV lookup", () => {
		const d = pri("carrier-cw-pa.ipcc", "overrides_D10_D11.der.pri");
		const vdp = defined(d.efs.find((e) => e.path.endsWith("/voice_domain_pref")));
		expect(vdp).toMatchObject({
			name: "Voice domain preference",
			label: "CS voice only",
			confidence: "high",
		});
		const police = defined(d.efs.find((e) => e.path === "/mav/mav_police_pri_mode_pref_mask"));
		expect(police.label).toBeUndefined();
		expect(police.confidence).toBe("low");
	});
});

describe("iOS 27.0 fixtures", () => {
	const fx = (name: string) => {
		const bytes = new Uint8Array(readFileSync(join(here, "fixtures", name)));
		return decodePri(bytes, name.endsWith(".der.gri") ? "der.gri" : "der.pri");
	};
	const V = (carrier: string) => fx(`pri/${carrier}.der.pri`);
	const PRI = ["altice", "chinatelecom", "crosswireless", "docomo", "ktf", "unitedwireless", "lebara"];

	it("decodes every .der.pri with a MAVZ schema, a 35-item NV list and a revision matching NV 62005", () => {
		for (const c of PRI) {
			const d = V(c);
			expect(d.errors, c).toEqual([]);
			expect(d.schema.source, c).toBe("MAVZ");
			expect(d.schema.count, c).toBeGreaterThan(300);
			expect(d.nvItems.length, c).toBe(35);
			expect(defined(d.nv.find((x) => x.item === 62005)).label, c).toBe(d.header["PRI Revision"]);
			for (const u of d.unknown) expect(u.tag, c).toBe("9fa710");
			for (const x of d.nv) expect(d.nvItems, `${c} ${x.tag}`).toContain(x.item);
		}
	});

	it("decodes the NV tags new in iOS 27", () => {
		const d = V("crosswireless");
		expect(d.nv.map((x) => [x.tag, x.item, intOf(x.value)])).toEqual([
			["9fa660", 4960, 1],
			["9f833a", 442, 255],
			["9f8429", 553, 5],
			["9fa250", 4432, 7],
			["9fa129", 4265, 0],
			["9f83e435", 62005, 10551552],
			["9f8732", 946, 48894],
			["9f9b05", 3461, 0],
			["9fa016", 4118, 24],
			["9fa072", 4210, 6],
			["9fae07", 5895, 1],
			["9fb542", 6850, 13],
			["9f83c525", 58021, 246],
		]);
		const ct = V("chinatelecom").nv;
		expect(ct.find((x) => x.tag === "9f8311")).toMatchObject({ item: 401, name: "GPSOne PDE TCP Address" });
		expect(ct.find((x) => x.tag === "9f832a")).toMatchObject({ item: 426, name: "GPSOne PDE Port" });
		const ktf = V("ktf").nv;
		expect(defined(ktf.find((x) => x.item === 4703)).value.text).toBe("e-slp.kt.com:7276");
		expect(defined(ktf.find((x) => x.item === 6792)).label).toBe("2.0.1");
		expect(defined(ktf.find((x) => x.item === 3758)).label).toBe("On");
		expect(defined(ktf.find((x) => x.tag === "9f83e447")).item).toBe(62023);
		const uw = V("unitedwireless").nv;
		expect(defined(uw.find((x) => x.tag === "9f8657")).name).toBe("RTRE Configuration");
		expect(defined(uw.find((x) => x.tag === "9f83e44a")).value).toMatchObject({ kind: "bytes", len: 14 });
		expect(defined(V("docomo").nv.find((x) => x.tag === "9f870d")).name).toBe(
			"GSM/UMTS SMS Bearer Preference",
		);
	});

	it("decodes the CCM groups, including the unnamed ninth", () => {
		const alt = V("altice").featureGroups;
		expect(alt.map((g) => [g.tag, g.nv, g.bits])).toEqual([
			["9f83e43c", 62012, [20]],
			["9f83e453", 62035, [2]],
		]);
		expect(alt[1]?.confidence).toBe("low");
		const vf = V("lebara").featureGroups;
		expect(vf.map((g) => [g.name, g.bits])).toEqual([
			["Call Manager Feature Group", [20]],
			["System Determination Feature Group", [17]],
		]);
	});

	it("labels iOS 27 EFS values", () => {
		const efs = V("altice").efs;
		const get = (s: string) => defined(efs.find((e) => e.path.endsWith(s)));
		expect(get("/voice_domain_pref").label).toBe("IMS PS voice preferred");
		expect(get("/ue_usage_setting").label).toBe("Voice centric");
		expect(get("/sms_domain_pref").label).toBe("PS (IMS) SMS preferred");
		expect(efs.every((e) => e.meaning)).toBe(true);
	});

	it("decodes a .der.gri with a raw schema and the GRI revision in NV 62033", () => {
		const d = fx("pri/default-f.der.gri");
		expect(d.header).toEqual({ "GRI Revision": "14.0.9" });
		expect(d.schema.source).toBe("raw");
		expect(d.schema.count).toBe(6);
		expect(d.nv).toMatchObject([{ item: 62033, tag: "9f83e451", label: "14.0.9", name: "GRI revision" }]);
	});

	it("decodes %qu[N]: strings and %u: scalars in the trimmed CPS .der.gri", () => {
		const d = fx("pri/default-g-cut.der.gri");
		expect(d.header).toEqual({ "GRI Revision": "3.0.16" });
		const qu = d.efs.filter((e) => e.path.startsWith("%qu["));
		const u = d.efs.filter((e) => e.path.startsWith("%u:"));
		expect([qu.length, u.length]).toEqual([30, 10]);
		expect(qu.every((e) => e.value.kind === "string" && e.tag === "9fae72")).toBe(true);
		expect(u.every((e) => e.value.kind === "int")).toBe(true);
		expect(qu[0]).toMatchObject({
			path: "%qu[8]:dyn_cps_gri.lte_regulatory_info.na_table[0][0]",
			value: { text: "mcc:302" },
		});
		expect(qu[0]?.meaning).toContain("Intel-dialect NVM field");
		expect(d.unknown).toEqual([]);
	});
});
