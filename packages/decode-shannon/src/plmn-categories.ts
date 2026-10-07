/**
 * The carrier categories that index uecap combination files, as `plmn_mapping_*` confseqs give them: what
 * `ap_plmn_mapping.binarypb` holds on the builds that have it.
 */

import type { ItemLookup } from "./lte-ca.ts";
import { type Plmn, unpackPlmn } from "./plmn.ts";
import { int, ShannonFormatError } from "./wire.ts";

export interface PlmnCategory {
	readonly index: number;
	readonly name: string;
	readonly plmns: readonly Plmn[];
}

const PREFIX = "NRCAPA_CA_NV_PLMN";

/** The NUL-terminated name, one byte per value. */
function categoryName(values: readonly bigint[]): string {
	const end = values.indexOf(0n);
	return String.fromCharCode(
		...values.slice(0, end < 0 ? values.length : end).map((v) => int(v, "category name")),
	);
}

/** Categories in the order `..._CATEGORY_ID` lists them; none when the items are absent. */
export function confseqPlmnCategories(item: ItemLookup): PlmnCategory[] {
	const ids = item(`${PREFIX}_CATEGORY_ID`) ?? [];
	const counts = item(`NRCAPA_CA_NV_NUM_OF_PLMN_CATEGORY_ITEMS`) ?? [];
	return ids.map((id, i) => {
		const plmns = (item(`${PREFIX}_IDS_FOR_PLMN_CATEGORY_ID_${id}`) ?? []).map((p) =>
			unpackPlmn(int(p, "PLMN")),
		);
		if (BigInt(plmns.length) !== counts[i])
			throw new ShannonFormatError(
				`PLMN category ${id}: ${plmns.length} PLMNs, ${counts[i] ?? "no"} counted`,
			);
		return {
			index: int(id, "category"),
			name: categoryName(item(`${PREFIX}_NAME_FOR_PLMN_CATEGORY_ID_${id}`) ?? []),
			plmns,
		};
	});
}
