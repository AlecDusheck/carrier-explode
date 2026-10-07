/** The Galaxy phones a scope names, from Google Play's list of the devices it supports. */

import { DataError } from "../errors.ts";
import type { Scope } from "../scope.ts";

/** UTF-16LE CSV: Retail Branding, Marketing Name, Device, Model. */
export const SUPPORTED_DEVICES = "https://storage.googleapis.com/play_public/supported_devices.csv";

const HEADER = "Retail Branding,Marketing Name,Device,Model";
const ROW = /^"((?:[^"]|"")*)","((?:[^"]|"")*)","((?:[^"]|"")*)","((?:[^"]|"")*)"$/;
/** US models: a carrier's `U` and the unlocked `U1`. */
const US_MODEL = /^SM-[SFGN]\d{3,4}U1?$/;

/** A phone's family and generation, as its name gives them: `Galaxy Z Fold8 Ultra` is `Galaxy Z Fold` 8. */
interface Line {
	readonly family: string;
	readonly generation: number;
}

export interface GalaxyPhone {
	readonly model: string;
	readonly line: Line;
}

function lineOf(name: string, { families, exclude }: Scope["samsung"]): Line | undefined {
	if (exclude.some((x) => name.includes(x))) return undefined;
	const family = families.find((f) => name.startsWith(f));
	const generation = family === undefined ? undefined : /^\d+/.exec(name.slice(family.length))?.[0];
	return family === undefined || generation === undefined
		? undefined
		: { family, generation: Number.parseInt(generation, 10) };
}

/** The US Samsung models in `csv` (decoded) on one of the scope's lines. */
export function galaxyPhones(csv: string, scope: Scope["samsung"]): GalaxyPhone[] {
	const [header, ...rows] = csv.split(/\r?\n/);
	if (header !== HEADER) throw new DataError(`${SUPPORTED_DEVICES}: header ${header ?? "missing"}`);
	const phones = new Map<string, GalaxyPhone>();
	for (const row of rows) {
		if (row === "") continue;
		const fields = ROW.exec(row)
			?.slice(1)
			.map((f) => f.replaceAll('""', '"'));
		if (fields === undefined) throw new DataError(`${SUPPORTED_DEVICES}: not four quoted fields: ${row}`);
		const [brand = "", name = "", , model = ""] = fields;
		if (brand !== "Samsung" || !US_MODEL.test(model)) continue;
		const line = lineOf(name.replace(/ 5G$/, ""), scope);
		if (line !== undefined) phones.set(model, { model, line });
	}
	return [...phones.values()];
}
