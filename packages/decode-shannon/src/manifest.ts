/** Manifests (`carrierconfig/manifests/<sha1>`): which confseqs make up one carrier's configuration, per SIM scope. */

import { bytesToHex, wireFields } from "@carrier-explode/binary";
import { enumOf, int, required, ShannonFormatError, text, unexpected } from "./wire.ts";

/** Entry field 1, from 0 (left out on the wire). Confseq names end in the same scope, except files. */
const MANIFEST_SCOPES = ["common", "sim1", "sim2", "multislot", "file"] as const;
export type ManifestScope = (typeof MANIFEST_SCOPES)[number];

/**
 * Fields 6-8: the entry applies only on hardware where `key` has `value` and, from Exynos 5300 builds, whose
 * variant is `variant` (left out: 0). Which device each value is, the images do not say.
 */
export interface HardwareCondition {
	readonly key: number;
	readonly value: number;
	readonly variant: number;
}

/** Field 8 on entries that apply to every variant, and on every unconditional entry that has it. */
const ANY_VARIANT = 4;

interface EntryBase {
	/** The confseq's file name: hex SHA-1. */
	readonly confseq: string;
	/** Field 4: set on the shared layers (default, endc_*, lte_ca_*). */
	readonly base: boolean;
}

type ManifestEntry =
	| (EntryBase & {
			readonly scope: Exclude<ManifestScope, "file">;
			readonly condition: HardwareCondition | null;
	  })
	/** A file installed at `path` (root certificates); its confseq is PEM, not a protobuf. */
	| (EntryBase & { readonly scope: "file"; readonly path: string });

export interface Manifest {
	readonly version: string;
	/** The config name, as cfg.db's confnames gives it (`us_tmo`). */
	readonly name: string;
	/** cfg.db's carrier id; 0 (left out) for `wildcard`. */
	readonly carrierId: number;
	readonly entries: readonly ManifestEntry[];
}

function entry(b: Uint8Array): ManifestEntry {
	let scope = 0;
	let confseq: string | undefined;
	let base = false;
	let path: string | undefined;
	let key: number | undefined;
	let value: number | undefined;
	let variant: number | undefined;
	for (const f of wireFields(b)) {
		switch (f.key) {
			case "1:varint":
				scope = int(f.value, "manifest scope");
				break;
			case "2:bytes":
				if (f.value.length !== 20)
					throw new ShannonFormatError(`manifest confseq of ${f.value.length} bytes`);
				confseq = bytesToHex(f.value);
				break;
			case "4:varint":
				base = f.value !== 0n;
				break;
			case "5:bytes":
				path = text(f.value);
				break;
			case "6:varint":
				key = int(f.value, "condition key");
				break;
			case "7:varint":
				value = int(f.value, "condition value");
				break;
			case "8:varint":
				variant = int(f.value, "condition variant");
				break;
			default:
				unexpected(f, "manifest entry");
		}
	}
	const common = { confseq: required(confseq, "manifest confseq"), base };
	const s = enumOf(MANIFEST_SCOPES, scope + 1, "manifest scope");
	if (s === "file") {
		if (key !== undefined || value !== undefined)
			throw new ShannonFormatError("a file entry with a condition");
		return { ...common, scope: s, path: required(path, "file path") };
	}
	if (path !== undefined) throw new ShannonFormatError(`a ${s} entry with a path`);
	if (key === undefined || value === undefined) {
		if (key !== value || (variant !== undefined && variant !== ANY_VARIANT))
			throw new ShannonFormatError(
				`an unconditional entry with key ${key}, value ${value}, variant ${variant}`,
			);
		return { ...common, scope: s, condition: null };
	}
	return { ...common, scope: s, condition: { key, value, variant: variant ?? 0 } };
}

export function decodeManifest(bytes: Uint8Array): Manifest {
	let version: string | undefined;
	let name: string | undefined;
	let carrierId = 0;
	const entries: ManifestEntry[] = [];
	for (const f of wireFields(bytes)) {
		switch (f.key) {
			case "1:bytes":
				version = text(f.value);
				break;
			case "2:bytes":
				name = text(f.value);
				break;
			case "3:varint":
				carrierId = int(f.value, "carrier id");
				break;
			case "5:bytes":
				entries.push(entry(f.value));
				break;
			default:
				unexpected(f, "manifest");
		}
	}
	return {
		version: required(version, "manifest version"),
		name: required(name, "manifest name"),
		carrierId,
		entries,
	};
}
