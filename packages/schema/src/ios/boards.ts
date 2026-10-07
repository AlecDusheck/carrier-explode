/** Which phone an override file's board is (`overrides_D93_D94.plist`), from the boards the device records list. */

import type { Device } from "../types.ts";

/** Lower-case board → product type. */
export type BoardProducts = ReadonlyMap<string, string>;

/** A board as a file names it, with its product type when a device record lists the board. */
export interface BoardRef {
	readonly board: string;
	readonly product?: string;
}

/** Records name a board by its config (`D93AP`); files by the board alone, in either case (`N90B` is N90bAP). */
const boardKey = (config: string): string => config.replace(/AP$/i, "").toLowerCase();

export const boardProducts = (devices: ReadonlyArray<Pick<Device, "code" | "boards">>): BoardProducts =>
	new Map(devices.flatMap((d) => d.boards.map((config): [string, string] => [boardKey(config), d.code])));

/** Exactly, else without one lower-case suffix (`N61x` is N61's). */
export const productOf = (products: BoardProducts, board: string): string | undefined =>
	products.get(board.toLowerCase()) ??
	(/[a-z]$/.test(board) ? products.get(board.slice(0, -1).toLowerCase()) : undefined);

export const boardRefs = (boards: readonly string[], products: BoardProducts): BoardRef[] =>
	boards.map((board) => {
		const product = productOf(products, board);
		return product === undefined ? { board } : { board, product };
	});
