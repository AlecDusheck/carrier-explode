/** The bundle directories copied out of a filesystem image by ./apfs-extract, which needs no FUSE or mount. */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { DataError } from "../../../../../src/errors.ts";
import { BUNDLE_DIRS, type BundleKind } from "./bundles.ts";

/** APFS_EXTRACT points local runs at a built helper; the container image has it on PATH. */
const helper = (): string => process.env["APFS_EXTRACT"] ?? "apfs-extract";

function run(cmd: string, args: readonly string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		// stdout is go-apfs's progress bars; stderr carries the errors.
		const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
		const err: Buffer[] = [];
		child.stderr.on("data", (b: Buffer) => err.push(b));
		child.on("error", reject);
		child.on("close", (code, signal) => {
			const stderr = Buffer.concat(err).toString().trim().slice(-2000);
			// Killed (out of memory, the container stopping) may pass in a fresh container; an exit is the image's doing.
			if (signal) reject(new Error(`${cmd} killed by ${signal}: ${stderr}`));
			else if (code !== 0) reject(new DataError(`${cmd} exited ${code}: ${stderr}`));
			else resolve();
		});
	});
}

export async function extractBundleDirs(image: string, dest: string): Promise<Record<BundleKind, string>> {
	const out = { carrier: join(dest, "carrier"), country: join(dest, "country") } as const satisfies Record<
		BundleKind,
		string
	>;
	await Promise.all([mkdir(out.carrier, { recursive: true }), mkdir(out.country, { recursive: true })]);
	await run(helper(), [image, BUNDLE_DIRS.carrier, out.carrier, BUNDLE_DIRS.country, out.country]);
	return out;
}
