/** An IPSW's BuildManifest.plist: version, build, phones, and where each board's parts are. */

import * as v from "valibot";

import { parsePlist } from "./plist.ts";
import { compareProducts } from "./versions.ts";

const Component = v.looseObject({ Info: v.optional(v.looseObject({ Path: v.optional(v.string()) })) });

const Schema = v.looseObject({
	ProductVersion: v.string(),
	ProductBuildVersion: v.string(),
	SupportedProductTypes: v.array(v.string()),
	BuildIdentities: v.array(
		v.looseObject({
			Info: v.looseObject({ DeviceClass: v.string(), Variant: v.optional(v.string()) }),
			"Ap,ProductType": v.string(),
			Manifest: v.record(v.string(), v.unknown()),
		}),
	),
});

interface BuildIdentity {
	/** Board config, lower-case: `d93ap`. */
	readonly board: string;
	/** The phone it installs: `iPhone17,1`. */
	readonly product: string;
	/** `Customer Erase Install (IPSW)`, `Customer Upgrade Install (IPSW)`, `Recovery Customer Install`. */
	readonly variant: string;
	/** Manifest key (`OS`, `BasebandFirmware`, `Cellular1,RTKitOS`) -> path inside the IPSW. */
	readonly paths: ReadonlyMap<string, string>;
}

export interface BuildManifest {
	readonly version: string;
	readonly build: string;
	/** iPhone product types, oldest first. */
	readonly devices: readonly string[];
	readonly identities: readonly BuildIdentity[];
}

export function parseBuildManifest(bytes: Uint8Array): BuildManifest {
	const m = v.parse(Schema, parsePlist(bytes));
	return {
		version: m.ProductVersion,
		build: m.ProductBuildVersion,
		devices: [...new Set(m.SupportedProductTypes)].toSorted(compareProducts),
		identities: m.BuildIdentities.map((bi) => {
			const paths = new Map<string, string>();
			for (const [key, c] of Object.entries(bi.Manifest)) {
				const path = v.is(Component, c) ? c.Info?.Path : undefined;
				if (path) paths.set(key, path);
			}
			return {
				board: bi.Info.DeviceClass.toLowerCase(),
				product: bi["Ap,ProductType"],
				variant: bi.Info.Variant ?? "",
				paths,
			};
		}),
	};
}

/** The install identities' `OS` image, which holds the bundles (not a cryptex; recovery identities name their own small OS). */
export function osImagePath(m: BuildManifest): string {
	const install = m.identities.filter((i) => !/recovery/i.test(i.variant));
	const paths = new Set(install.flatMap((i) => i.paths.get("OS") ?? []));
	const [only, ...rest] = paths;
	if (!only) throw new Error(`${m.build}: BuildManifest names no OS image`);
	if (rest.length)
		throw new Error(`${m.build}: BuildManifest names ${paths.size} OS images: ${[...paths].join(", ")}`);
	return only;
}

/** Modem package path -> the phones it is the modem of, oldest first: `BasebandFirmware` (Qualcomm, Intel) or `Cellular1,*` (Apple C1), not Rose or Wi-Fi ftabs. */
export function modemDevices(m: BuildManifest): ReadonlyMap<string, readonly string[]> {
	const out = new Map<string, Set<string>>();
	for (const id of m.identities) {
		for (const [key, path] of id.paths) {
			if (key !== "BasebandFirmware" && !key.startsWith("Cellular1,")) continue;
			const devices = out.get(path) ?? new Set<string>();
			devices.add(id.product);
			out.set(path, devices);
		}
	}
	return new Map([...out].map(([p, d]) => [p, [...d].toSorted(compareProducts)]));
}
