/** The image's bundle directories, and their bundles read back one at a time. Symlinks there (`202 -> Greece.bundle`) are lookup aliases, not bundles. */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { compareUtf8 } from "@carrier-explode/binary";
import { isJunk, type UnpackedBundle, type UnpackedFile } from "@carrier-explode/decode-ios";
import type { SourceKind } from "@carrier-explode/schema/types";

/** The kinds of bundle an image holds a directory of. */
export type BundleKind = Exclude<SourceKind, "default">;

export const BUNDLE_DIRS = {
	carrier: "/System/Library/Carrier Bundles/iPhone",
	country: "/System/Library/CountryBundles/iPhone",
} as const satisfies Record<BundleKind, string>;

export interface BundleDir {
	readonly name: string;
	readonly path: string;
}

const SUFFIX = ".bundle";

export async function listBundles(dir: string): Promise<BundleDir[]> {
	const out: BundleDir[] = [];
	for (const e of await readdir(dir, { withFileTypes: true })) {
		if (e.isDirectory() && e.name.endsWith(SUFFIX))
			out.push({ name: e.name.slice(0, -SUFFIX.length), path: join(dir, e.name) });
	}
	return out.toSorted((a, b) => compareUtf8(a.name, b.name));
}

async function walk(root: string, rel: string, out: UnpackedFile[]): Promise<void> {
	for (const e of await readdir(join(root, rel), { withFileTypes: true })) {
		const path = rel ? `${rel}/${e.name}` : e.name;
		if (e.isDirectory()) await walk(root, path, out);
		else if (e.isFile() && !isJunk(path))
			out.push({ path, bytes: new Uint8Array(await readFile(join(root, path))) });
	}
}

export async function readBundle(b: BundleDir): Promise<UnpackedBundle> {
	const files: UnpackedFile[] = [];
	await walk(b.path, "", files);
	return { name: b.name, files: files.toSorted((x, y) => compareUtf8(x.path, y.path)) };
}
