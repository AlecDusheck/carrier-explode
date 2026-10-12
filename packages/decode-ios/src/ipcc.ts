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
export const isJunk = (path: string): boolean =>
	path.startsWith("__MACOSX") || path === ".DS_Store" || path.endsWith("/.DS_Store");

export interface BundleMembers {
	/** The zip path of the `<Name>.bundle/` directory, with its trailing slash. */
	readonly root: string;
	/** Without `.bundle`: `TMobile_us`, `UnitedStates`. */
	readonly name: string;
	/** Its files' paths inside it. */
	readonly paths: readonly string[];
}

/** The first `<Name>.bundle/` directory among a zip's member names; the whole zip, as `bundle`, when it has none. */
export function bundleMembers(names: readonly string[]): BundleMembers {
	const [, root = "", name = "bundle"] =
		names.map((n) => /^(.*?([^/]+)\.bundle\/)/.exec(n)).find((m) => m !== null) ?? [];
	const paths = names
		.filter((n) => n.startsWith(root) && !n.endsWith("/"))
		.map((n) => n.slice(root.length))
		.filter((path) => path !== "" && !isJunk(path));
	return { root, name, paths };
}

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
	const { root, name, paths } = bundleMembers(Object.keys(zip));
	const files = paths
		.flatMap((path) => {
			const data = zip[root + path];
			return data === undefined ? [] : [{ path, bytes: data }];
		})
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
