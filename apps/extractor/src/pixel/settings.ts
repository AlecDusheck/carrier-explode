/**
 * A Pixel's CarrierSettings: each file one source, others.pb split into its parts (each a source of its own, carrying
 * others.pb's version), and carrier_list.pb, which is no source but the build's SIM routing.
 */

import {
	decodeCarrierSettings,
	splitMultiCarrierSettings,
	type CarrierSettings,
} from "@carrier-explode/decode-android";
import {
	FsNotFoundError,
	MissingPartitionError,
	openFilesystem,
	openPartition,
	type DirEntry,
	type Filesystem,
	type Payload,
} from "@carrier-explode/firmware";
import { sourceKey, type SourceKey, type SourceRef } from "@carrier-explode/schema/types";
import { DataError } from "../errors.ts";

export class PixelError extends DataError {
	override name = "PixelError";
}

const DIR = "etc/CarrierSettings";
const DEFAULTS: ReadonlySet<string> = new Set(["default", "no_sim"]);
/** Not CarrierSettings: the carrier data release the directory was built from, and a placeholder file. */
const NOT_SETTINGS: ReadonlySet<string> = new Set(["label", "GsCommonCarrierSettingsExtraAssets"]);
export const CARRIER_LIST = "carrier_list.pb";
export const OTHERS = "others.pb";

/** One source's CarrierSettings, decoded. */
export interface SettingsFile {
	readonly bytes: Uint8Array;
	readonly settings: CarrierSettings;
	readonly source: SourceRef<"android">;
	readonly version: string;
}

/** The source a CarrierSettings file is, by its canonical name: no_sim.pb and default.pb, which every carrier file is read over, are defaults. */
export const settingsSource = (name: string): SourceRef<"android"> => ({
	platform: "android",
	kind: DEFAULTS.has(name) ? "default" : "carrier",
	name,
});

/** Where CarrierSettings are: the product partition's etc/, or before Pixels had one (Android 10-11 on the Pixel 1 and 2), system's /system/product/etc/. */
export async function settingsRoot(
	payload: Payload,
): Promise<{ readonly fs: Filesystem; readonly dir: string }> {
	try {
		return { fs: await openFilesystem(await openPartition(payload, "product")), dir: DIR };
	} catch (e) {
		if (!(e instanceof MissingPartitionError)) throw e;
		return { fs: await openFilesystem(await openPartition(payload, "system")), dir: `system/product/${DIR}` };
	}
}

async function entriesOf(fs: Filesystem, dir: string): Promise<readonly DirEntry[]> {
	try {
		return await fs.readdir(dir);
	} catch (e) {
		throw e instanceof FsNotFoundError ? new PixelError(`no ${dir}`) : e;
	}
}

/** The directory's .pb files, in inode order: over a payload partition, the order its files' operations come in. */
export async function settingsNames(fs: Filesystem, dir: string): Promise<string[]> {
	return (await entriesOf(fs, dir))
		.filter((e) => e.kind === "file" && !NOT_SETTINGS.has(e.name))
		.toSorted((a, b) => a.inode - b.inode)
		.map((e) => {
			if (!e.name.endsWith(".pb")) throw new PixelError(`${dir}/${e.name} is not a .pb`);
			return e.name;
		});
}

/** A CarrierSettings file, which must be named after its canonical name and carry its version. */
export function settingsFile(name: string, bytes: Uint8Array): SettingsFile {
	const settings = decodeCarrierSettings(bytes);
	const { canonicalName, version } = settings;
	if (`${canonicalName}.pb` !== name) throw new PixelError(`${name} names itself "${canonicalName}"`);
	if (version === undefined) throw new PixelError(`${name} has no version`);
	return { bytes, settings, source: settingsSource(canonicalName), version };
}

/**
 * others.pb's parts, byte for byte, versioned by others.pb. It holds carriers without a file of their own, so a part
 * named like one of `files` is left out (Android 12-13's telenor_se).
 */
export function othersParts(bytes: Uint8Array, files: ReadonlySet<string>): SettingsFile[] {
	const { version, settings } = splitMultiCarrierSettings(bytes);
	if (version === undefined) throw new PixelError(`${OTHERS} has no version`);
	const seen = new Set<SourceKey>();
	return settings.flatMap((part): SettingsFile[] => {
		const cs = decodeCarrierSettings(part);
		if (cs.version !== undefined)
			throw new PixelError(`${OTHERS}: ${cs.canonicalName} carries its own version`);
		if (files.has(`${cs.canonicalName}.pb`)) return [];
		const source = settingsSource(cs.canonicalName);
		if (seen.has(sourceKey(source))) throw new PixelError(`${OTHERS} holds ${cs.canonicalName} twice`);
		seen.add(sourceKey(source));
		return [{ bytes: part, settings: cs, source, version }];
	});
}
