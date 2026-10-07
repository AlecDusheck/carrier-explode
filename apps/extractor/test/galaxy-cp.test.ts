import { describe, expect, it } from "vitest";

import { decodeLz4Stream, FsError } from "@carrier-explode/firmware";
import { cpImage } from "../src/galaxy/members.ts";

/** `body` as one LZ4 frame of one stored block: version 1, 64 KB blocks, no checksums. */
function lz4Frame(body: Uint8Array): Uint8Array {
	const frame = new Uint8Array(4 + 3 + 4 + body.length + 4);
	const view = new DataView(frame.buffer);
	view.setUint32(0, 0x184d2204, true);
	frame.set([0x40, 0x40, 0x00], 4);
	view.setUint32(7, (body.length | 0x80000000) >>> 0, true);
	frame.set(body, 11);
	return frame;
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
	yield bytes;
}

/** An image whose first bytes are `head`, the rest zero. */
const image = (head: string): Uint8Array => {
	const out = new Uint8Array(4096);
	out.set(new TextEncoder().encode(head));
	return out;
};

describe("cpImage", () => {
	it("reads an LZ4-framed Shannon image as no modem", async () => {
		expect(await cpImage(decodeLz4Stream(once(lz4Frame(image("TOC\0BOOT")))), "modem.bin.lz4")).toBeNull();
	});

	it("still fails on an image that is neither Shannon nor FAT", async () => {
		await expect(cpImage(decodeLz4Stream(once(lz4Frame(image("NOPE")))), "modem.bin.lz4")).rejects.toThrow(
			FsError,
		);
	});
});
