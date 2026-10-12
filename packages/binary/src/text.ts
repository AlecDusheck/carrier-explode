/** Bytes as text: hex, base64, Latin-1, and the printable-ASCII sniff the decoders use for opaque values. */

import { byteAt } from "./bounds.ts";

export class EncodingError extends Error {
	override name = "EncodingError";
}

/** A 32-bit value as 8 lower-case hex digits: how CRC-32s and Shannon item hashes are written. */
export const u32Hex = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");

/** Lower-case hex, no separators. */
export function bytesToHex(b: Uint8Array): string {
	let s = "";
	for (const x of b) s += x.toString(16).padStart(2, "0");
	return s;
}

/** Strict hex (either case, no separators); throws on an odd length or a non-hex digit. */
export function hexToBytes(s: string): Uint8Array {
	if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) throw new EncodingError(`not hex: ${s.slice(0, 40)}`);
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
	return out;
}

/** Bytes as upper-case colon-separated hex, the way certificate tools print serials and digests. */
export function colonHex(b: Uint8Array): string {
	return Array.from(b, (x) => x.toString(16).padStart(2, "0").toUpperCase()).join(":");
}

/** ISO-8859-1: one character per byte. Chunked so String.fromCharCode never gets too many arguments. */
export function latin1(b: Uint8Array): string {
	let s = "";
	for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
	return s;
}

/** True when `b` holds the ASCII string `s` at `offset`. */
export function asciiAt(b: Uint8Array, offset: number, s: string): boolean {
	if (offset < 0 || offset + s.length > b.length) return false;
	for (let i = 0; i < s.length; i++) if (byteAt(b, offset + i) !== s.charCodeAt(i)) return false;
	return true;
}

/** Standard base64 with padding. btoa exists in browsers, Workers and Node; it takes a binary string. */
export function bytesToBase64(b: Uint8Array): string {
	return btoa(latin1(b));
}

function binaryToBytes(bin: string): Uint8Array {
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** Strict standard base64 (padding optional); throws on anything else. */
export function base64ToBytes(s: string): Uint8Array {
	if (/[^A-Za-z0-9+/=]/.test(s) || s.length % 4 === 1)
		throw new EncodingError(`not base64: ${s.slice(0, 40)}`);
	try {
		return binaryToBytes(atob(s));
	} catch (e) {
		throw new EncodingError(`not base64: ${s.slice(0, 40)}`, { cause: e });
	}
}

/** Strict base64url (RFC 4648 §5), padding optional, as JWK writes it. */
export function base64UrlToBytes(s: string): Uint8Array {
	const body = s.replace(/=+$/, "");
	if (/[^A-Za-z0-9_-]/.test(body)) throw new EncodingError(`not base64url: ${s.slice(0, 40)}`);
	const std = body.replaceAll("-", "+").replaceAll("_", "/");
	return base64ToBytes(std.padEnd(Math.ceil(std.length / 4) * 4, "="));
}

/** Lenient base64 for text pulled out of documents: junk is dropped and a ragged tail decodes as far as it goes. */
export function b64ToBytes(s: string): Uint8Array {
	const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
	// A lone trailing character carries no whole byte; any other remainder only lacks its padding.
	const whole = clean.length % 4 === 1 ? clean.slice(0, -1) : clean;
	return binaryToBytes(atob(whole.padEnd(Math.ceil(whole.length / 4) * 4, "=")));
}

const utf8 = new TextDecoder();

/** Printable ASCII (tabs and line breaks allowed) before any NUL padding, else undefined; longer than `max` bytes is never text. */
export function maybeText(b: Uint8Array, max = 4096): string | undefined {
	if (b.length === 0 || b.length > max) return undefined;
	let end = b.length;
	while (end > 0 && byteAt(b, end - 1) === 0) end--;
	if (end === 0) return undefined;
	for (let i = 0; i < end; i++) {
		const c = byteAt(b, i);
		if (!(c === 9 || c === 10 || c === 13 || (c >= 0x20 && c < 0x7f))) return undefined;
	}
	return utf8.decode(b.subarray(0, end));
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as const;

const isXmlEntity = (name: string): name is keyof typeof XML_ENTITIES => Object.hasOwn(XML_ENTITIES, name);

/** XML's five named entities and its character references; any other, or one out of range, stays as written. */
export function decodeXmlEntities(s: string): string {
	if (!s.includes("&")) return s;
	return s.replace(
		/&(?:#x([\da-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g,
		(whole, hex?: string, dec?: string, name?: string) => {
			if (name !== undefined && isXmlEntity(name)) return XML_ENTITIES[name];
			const code = hex === undefined ? Number(dec) : parseInt(hex, 16);
			return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
		},
	);
}

/** One attribute of a start tag: its name, then its double-quoted, single-quoted or bare value, if it has one. */
export const XML_ATTR = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
