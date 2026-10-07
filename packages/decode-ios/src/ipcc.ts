/** Image bundles packaged as OTA-shaped .ipcc zips, deterministically: the same files always give the same bytes. */

import { unzipSync } from "fflate";

import { compareUtf8, packFiles } from "@carrier-explode/binary";
import { isPlistDict, parsePlist } from "./plist.ts";

/** One file, by its path inside the .bundle directory. */
export interface UnpackedFile {
	readonly path: string;
	readonly bytes: Uint8Array;
}

export interface UnpackedBundle {
	/** Without `.bundle`: `TMobile_us`, `UnitedStates`. */
	readonly name: string;
	readonly files: readonly UnpackedFile[];
}

/** Files Finder leaves behind, which neither the packager nor content ids count. */
export const isJunk = (path: string): boolean => path === ".DS_Store" || path.endsWith("/.DS_Store");

export function packIpcc(b: UnpackedBundle): Uint8Array {
	const entries = new Map<string, Uint8Array>();
	for (const f of b.files.filter((file) => !isJunk(file.path))) {
		const name = `Payload/${b.name}.bundle/${f.path}`;
		if (entries.has(name)) throw new Error(`${b.name}.bundle: ${f.path} twice`);
		entries.set(name, f.bytes);
	}
	return packFiles(entries);
}

/** The first `<Name>.bundle/` directory's files, as openIpcc finds it. */
export function unpackIpcc(bytes: Uint8Array): UnpackedBundle {
	const zip = unzipSync(bytes);
	const [, root, name] =
		Object.keys(zip)
			.map((n) => /^(.*?([^/]+)\.bundle\/)/.exec(n))
			.find((m) => m !== null) ?? [];
	if (root === undefined || name === undefined) throw new Error("ipcc has no .bundle directory");
	const files = Object.entries(zip)
		.filter(([n]) => n.startsWith(root) && !n.endsWith("/") && !isJunk(n.slice(root.length)))
		.map(([n, data]) => ({ path: n.slice(root.length), bytes: data }))
		.toSorted((x, y) => compareUtf8(x.path, y.path));
	return { name, files };
}

/** CFBundleVersion from Info.plist; undefined when it has none. */
export function bundleVersion(b: UnpackedBundle): string | undefined {
	const info = b.files.find((f) => f.path === "Info.plist");
	if (!info) return undefined;
	const plist = parsePlist(info.bytes);
	const version = isPlistDict(plist) ? plist.CFBundleVersion : undefined;
	return typeof version === "string" || typeof version === "number" ? String(version) : undefined;
}
