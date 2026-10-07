/** Which phone each Apple board is, from the feeds' device records, and the phones a bundle file's boards are, named. */

import { boardProducts, boardRefs, type BoardProducts } from "@carrier-explode/schema";
import type { NamedBoard, WithPhones } from "#lib/apple/phones.ts";
import { perRequest } from "../cache";
import { deviceNames, devicesOf } from "../catalog";

/** What an override file's name means. */
const boardsNow = perRequest(async (): Promise<BoardProducts> => boardProducts(await devicesOf("ios")));

/** Files with the phones their names' boards are, each named. */
export async function withPhones<F extends { readonly boards?: readonly string[] }>(
	files: readonly F[],
): Promise<Array<WithPhones<F>>> {
	const [products, names] = await Promise.all([boardsNow(), deviceNames("ios")]);
	return files.map((f): WithPhones<F> => {
		if (f.boards === undefined) return f;
		const refs = boardRefs(f.boards, products);
		return {
			...f,
			devices: refs.map(({ board, product }): NamedBoard =>
				product === undefined
					? { board, name: board }
					: { board, product, name: names.get(product) ?? product },
			),
		};
	});
}
