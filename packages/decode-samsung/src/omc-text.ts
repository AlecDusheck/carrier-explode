/**
 * Samsung's encoding of OMC text files (cscfeature.xml, customer_carrier_feature.json): each byte rotated left by
 * SHIFTS[i % 256] and XORed with SALTS[i % 256], over a gzip stream. Tables from fei-ke/OmcTextDecoder (Apache-2.0).
 */

import { Gunzip } from "fflate";
import { concatBytes, crc32, errorMessage, hexToBytes, u32le } from "@carrier-explode/binary";

const SALTS = hexToBytes(
	"41c521de6b1c95374e11af06b087dde9487ac1d54477b291c41f3c395ca89cbb965b455d6e175d35d4cd40b02e02fc0cd350d4dd91e4be8c2702e5d3cc7d2742" +
		"a63f97bd54c7fcfc65a6510adf0143c7b912b66660a740ef36a2acbe0e777902b2b1593f5d6db2cd42dc205603c6f15c3a02a7b0f3ff7afc303fd43b64d6d33b" +
		"f9efca22ca47c0e6a9b0efd4da90460a965fe8fc8a2dabf355199a890ddb742ebb3b2aa6da976589dc61fdc2a59f83110e6ab889636f1412e57140e84ac49c1a" +
		"38d4ba0ccd9ce0f51a308b62a333e7b1e1615797c007f39b2186059859d48b3fb0fab992e397746ba35bd7f3148db22b4f860666e0348acd489829da7c4882dd",
);
const SHIFTS = hexToBytes(
	"01010002020405000407010605030301020500060202040202030002010204030400000003050301060506010101000003020707050607030501000706030605" +
		"04050305010303010504010000020606060604000101000505040204060107010201010605040706050106070002060301070101070400040205030101050600" +
		"03050306050702050606020203060004030200020203050303020505050103010101040501060204070104060006040302060106030201060703020101050607" +
		"02020207040607050301040207010602040105060504050001010603070200020500010303020607070205060004010205030706050205020001030104030402",
);

/** The tables, for an encoder (tests round-trip through one). */
export const OMC_TABLES = { salts: SALTS, shifts: SHIFTS } as const;

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const eucKr = new TextDecoder("euc-kr", { fatal: true, ignoreBOM: false });

/** UTF-8, or Samsung's EUC-KR where a file is not: EUY's carrier features name its voicemail in KS X 1001 Cyrillic. */
function text(bytes: Uint8Array): string {
	try {
		return utf8.decode(bytes);
	} catch {
		return eucKr.decode(bytes);
	}
}

/** A plain file passes through: older packages and customer.xml are not encoded. */
const isPlain = (b: Uint8Array): boolean =>
	b[0] === 0x3c || b[0] === 0x7b || (b[0] === 0xef && b[1] === 0xbb);

export class OmcTextError extends Error {
	override name = "OmcTextError";
}

function unmask(bytes: Uint8Array): Uint8Array {
	const out = new Uint8Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i] ?? 0;
		const s = SHIFTS[i % 256] ?? 0;
		out[i] = (((b << s) | (b >>> (8 - s))) & 0xff) ^ (SALTS[i % 256] ?? 0);
	}
	return out;
}

/** Streamed rather than sized from the trailer: a damaged trailer can claim gigabytes. */
function gunzipChecked(gz: Uint8Array): Uint8Array {
	const parts: Uint8Array[] = [];
	new Gunzip((chunk) => {
		parts.push(chunk);
	}).push(gz, true);
	const out = concatBytes(parts);
	if (crc32(out) !== u32le(gz, gz.length - 8) || out.length % 2 ** 32 !== u32le(gz, gz.length - 4))
		throw new OmcTextError("the gzip stream's CRC-32 or size disagrees with its trailer");
	return out;
}

const CR = 0x0d;
const LF = 0x0a;

/** Every CR LF back to LF: the inverse of a text-mode LF → CR LF conversion. */
function undoCrLf(bytes: Uint8Array): Uint8Array {
	return bytes.filter((b, i) => !(b === CR && bytes[i + 1] === LF));
}

function inflate(bytes: Uint8Array): Uint8Array {
	try {
		return gunzipChecked(unmask(bytes));
	} catch (asStored) {
		// Some packs' encoded files went through a text-mode LF → CR LF conversion; the gzip trailer tells which
		// reading is Samsung's.
		const undone = undoCrLf(bytes);
		if (undone.length === bytes.length) throw asStored;
		try {
			return gunzipChecked(unmask(undone));
		} catch (converted) {
			throw new OmcTextError(
				`not an OMC text file as stored (${errorMessage(asStored)}) nor with CR LF undone (${errorMessage(converted)})`,
			);
		}
	}
}

export function decodeOmcText(bytes: Uint8Array): string {
	return text(isPlain(bytes) ? bytes : inflate(bytes));
}
