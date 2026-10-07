/** Whether a phone has a 5G radio, as its own settings show: no table of models. */

import type { ConfigRadio } from "./modem/index.ts";

/** A phone lacks 5G when some of its settings configure its radio and none for 5G; null when none of them say. */
export function has5g(radios: Iterable<ConfigRadio>): boolean | null {
	const read = [...radios].filter((r) => r !== "unread");
	return read.length === 0 ? null : read.includes("nr");
}

/** A modem configuration's base layers configure the modem as much as its own items do. */
export const layeredRadio = (own: ConfigRadio, base: ConfigRadio | null): ConfigRadio =>
	base === "nr" ? "nr" : own;
