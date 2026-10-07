// erofs-compact.img: `mkfs.erofs -T0 --all-time -zlz4hc` (erofs-utils 1.9.4): compact indexes, 4 KiB pclusters, LZ4 zero padding.
// erofs-full.img: the same with `-C16384 -Elegacy-compress`: full indexes, big pclusters, no zero padding.
// Both over erofsFiles().

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bytesSource, openFilesystem } from "../src/index.ts";
import { erofsFiles } from "./erofs-content.ts";

const image = (name: string): Uint8Array =>
	new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe.each(["erofs-compact.img", "erofs-full.img"])("%s", (name) => {
	it("decompresses every file to its bytes", async () => {
		const fs = await openFilesystem(bytesSource(image(name)));
		for (const [path, bytes] of Object.entries(erofsFiles()))
			expect(Buffer.from(await fs.readFile(path)).equals(Buffer.from(bytes))).toBe(true);
	});
});
