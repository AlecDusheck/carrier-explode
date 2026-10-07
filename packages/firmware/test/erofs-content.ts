/** The files in fixtures/erofs-*.img, rebuilt by the test that reads them: repetitive text over many clusters, noise that stays uncompressed, and a short file. */

export function erofsFiles(): Record<string, Uint8Array> {
	let s = "";
	for (let i = 0; s.length < 200_000; i++) s += `<key>Entry${i % 97}</key><integer>${i % 13}</integer>\n`;
	let x = 2463534242;
	const noise = Uint8Array.from({ length: 20_000 }, () => {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		return x & 0xff;
	});
	return {
		"repeat.txt": new TextEncoder().encode(s.slice(0, 200_000)),
		"noise.bin": noise,
		"short.txt": new TextEncoder().encode("hi\n"),
	};
}
