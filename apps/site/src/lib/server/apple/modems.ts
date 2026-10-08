/** iOS modem packages: where their summaries are stored, and a build's packages as the pages show them. */

import { byNewest, MODEM_SUMMARY_SCHEMA } from "@carrier-explode/decode-ios";
import { keys } from "@carrier-explode/storage";
import type { ModemKind } from "@carrier-explode/schema/types";
import type { Named } from "#lib/types.ts";
import type { BuildModem } from "../builds";
import { deviceNames, shippedModems, type ShippedModem } from "../catalog";

/** R2 key of package `id`'s decoded summary, written by the extractor's iOS container. */
export const summaryKey = (id: string): string => keys.basebandSummary(MODEM_SUMMARY_SCHEMA, id);

export interface ModemView {
	/** The package's generation: `Mav25`, `c4000`. */
	readonly family: Named;
	readonly package: {
		readonly id: string;
		readonly name: string;
		readonly size: number;
		readonly kind: ModemKind;
	};
	readonly devices: readonly Named[];
}

/** An iOS modem row: the index states its package. */
export type ShippedPackage = ShippedModem & {
	readonly package: string;
	readonly size: number;
	readonly kind: ModemKind;
};

/** An iOS build's packages, as the index has them. */
export async function packagesOf(build: string): Promise<ShippedPackage[]> {
	return (await shippedModems("ios", build)).map(
		({ name, family, familyName, devices, package: sha, size, kind }) => {
			if (sha === null || size === null || kind === null)
				throw new Error(`${build}: iOS modem ${name} names no package`);
			return { name, family, familyName, devices, package: sha, size, kind };
		},
	);
}

/** Each package as the pages show it, its phones named, the ones serving the newest phone first. */
export async function modemViews(build: string): Promise<ModemView[]> {
	const [modems, names] = await Promise.all([packagesOf(build), deviceNames("ios")]);
	const phone = (code: string): Named => ({ code, name: names.get(code) ?? code });
	return byNewest(
		modems.map((m): ModemView => ({
			family: { code: m.family, name: m.familyName },
			package: { id: m.package, name: m.name, size: m.size, kind: m.kind },
			devices: m.devices.map(phone),
		})),
	);
}

/** An iOS build's modem packages, one per generation, newest phones first. */
export async function buildModems(build: string): Promise<BuildModem[]> {
	return (await modemViews(build)).map((v) => ({
		id: v.family.code,
		label: v.family.name,
		firmware: v.package.name,
		devices: v.devices,
	}));
}
