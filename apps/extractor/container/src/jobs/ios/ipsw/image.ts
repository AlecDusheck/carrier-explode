/** The IPSW's root filesystem image onto disk: streamed by Range, decrypted on the way when it is a .dmg.aea. */

import { createWriteStream } from "node:fs";
import { statfs } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import { osImagePath, type BuildManifest } from "@carrier-explode/decode-ios";
import { fcsKey, openAea, type PlainStream, type RemoteZip } from "@carrier-explode/firmware";
import { fetchApple, streamRange } from "@carrier-explode/http";
import { DataError } from "../../../../../src/errors.ts";
import type { JobContext } from "../../../job.ts";
import { fetchMember } from "../fetch-member.ts";

/** Left free beyond the image, for the bundle directories copied out of it. */
const MARGIN = 2 * 1024 ** 3;
/** How often a long download logs how far it got. */
const PROGRESS_MS = 30_000;

const fetchPem = async (url: string): Promise<string> => new TextDecoder().decode(await fetchApple(url));

async function assertRoom(dir: string, size: number): Promise<void> {
	const fs = await statfs(dir);
	const free = fs.bavail * fs.bsize;
	if (size + MARGIN > free)
		throw new DataError(
			`a ${size}-byte image does not fit in ${free} free bytes with a ${MARGIN}-byte margin`,
		);
}

async function* reporting(s: PlainStream, note: string, log: JobContext["log"]): AsyncGenerator<Uint8Array> {
	let done = 0;
	let loggedAt = Date.now();
	for await (const chunk of s.chunks) {
		yield chunk;
		done += chunk.length;
		if (Date.now() - loggedAt >= PROGRESS_MS) {
			loggedAt = Date.now();
			log(`${note}: ${done}/${s.size}`);
		}
	}
}

/** The image's path in `dir`. */
export async function downloadOsImage(
	zip: RemoteZip,
	url: string,
	manifest: BuildManifest,
	dir: string,
	log: JobContext["log"],
): Promise<string> {
	const member = osImagePath(manifest);
	const entry = zip.entry(member);
	if (!entry) throw new DataError(`BuildManifest names ${member}, which ${url} does not have`);
	const path = join(dir, "os.img");
	if (!member.endsWith(".aea")) {
		await assertRoom(dir, entry.size);
		await fetchMember(zip, url, entry, path);
		return path;
	}
	if (entry.method !== 0)
		throw new DataError(`${member} is compressed (method ${entry.method}); AEA images are stored`);
	const image = await openAea(
		streamRange(url, await zip.dataOffset(entry), entry.compressedSize),
		(authData) => fcsKey(authData, fetchPem),
	);
	await assertRoom(dir, image.size);
	await pipeline(reporting(image, member, log), createWriteStream(path));
	return path;
}
