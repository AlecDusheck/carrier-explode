/** Which phones a bundle configures for 5G: Apple shows the 5G switch (Show5GSwitch) only to a phone with a 5G radio. */

import { overrideBoards } from "@carrier-explode/decode-ios";
import type { ConfigRadio } from "../modem/index.ts";
import type { Device } from "../types.ts";
import { boardProducts, productOf } from "./boards.ts";

export const FIVE_G_SWITCH = "Show5GSwitch";

/** Each board a bundle's override plists name, as the file names it: "nr" when a file naming it gives the switch. */
export type BoardRadios = Readonly<Record<string, "nr" | "lte">>;

/** The boards of a profile's leaves, each `file` with a `key` in it. */
export function boardRadios(leaves: Iterable<{ readonly file: string; readonly key: string }>): BoardRadios {
	const radios: Record<string, "nr" | "lte"> = {};
	for (const { file, key } of leaves) {
		if (!file.endsWith(".plist")) continue;
		for (const board of overrideBoards(file) ?? [])
			radios[board] = radios[board] === "nr" || key === FIVE_G_SWITCH ? "nr" : "lte";
	}
	return radios;
}

/** What a build's bundles say of one phone's radio: 5G when a file for its board gives the switch, else LTE when one names its board. */
export function phoneRadio(
	bundles: Iterable<BoardRadios>,
	phone: Pick<Device, "code" | "boards">,
): ConfigRadio {
	const products = boardProducts([phone]);
	const own = [...bundles].flatMap((radios) =>
		Object.entries(radios).flatMap(([board, radio]) =>
			productOf(products, board) === phone.code ? [radio] : [],
		),
	);
	if (own.length === 0) return "unread";
	return own.includes("nr") ? "nr" : "lte";
}
