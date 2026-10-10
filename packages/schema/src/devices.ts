/** Devices in the order pages list them: newest first, by the release the feeds record. */

import type { Device } from "./types.ts";

export type DeviceOrder = (a: string, b: string) => number;

/** A device as the index names it. */
export type NamedDevice = Pick<Device, "code" | "released"> & { readonly name: string };

/** What a name says without the model code a Galaxy's carries (`Galaxy S26 Ultra (SM-S948U)`): its U and U1 share it. */
const baseName = (d: NamedDevice): string => d.name.replace(` (${d.code})`, "");

const byCode: (a: string, b: string) => number = new Intl.Collator("en", { numeric: true }).compare;

/**
 * Newest first, models of one name together on the newest of their days, by code; a launch's devices by code, highest
 * first. A code no device record lists goes last.
 */
export function newestFirst(devices: readonly NamedDevice[]): DeviceOrder {
	const groups = new Map<string, { readonly released: string; readonly top: string }>();
	for (const d of devices) {
		const g = groups.get(baseName(d));
		groups.set(baseName(d), {
			released: g === undefined || d.released > g.released ? d.released : g.released,
			top: g === undefined || byCode(d.code, g.top) > 0 ? d.code : g.top,
		});
	}
	const placed = new Map(
		devices.flatMap((d) => {
			const g = groups.get(baseName(d));
			return g === undefined ? [] : [[d.code, { name: baseName(d), ...g }] as const];
		}),
	);
	return (a, b) => {
		const x = placed.get(a),
			y = placed.get(b);
		if (x === undefined || y === undefined) return x === y ? a.localeCompare(b) : x === undefined ? 1 : -1;
		if (x.name === y.name) return byCode(a, b);
		return y.released.localeCompare(x.released) || byCode(y.top, x.top) || x.name.localeCompare(y.name);
	};
}

/** The newest of `codes`. */
export const newestOf = (order: DeviceOrder, codes: readonly string[]): string | undefined =>
	codes.toSorted(order)[0];
