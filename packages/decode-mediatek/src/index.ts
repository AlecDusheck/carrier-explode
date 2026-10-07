/**
 * MediaTek modem configuration (MCF) files, SBP operator ids, and md1rom's item table, which types and names their
 * values. No public format exists; the layout was read from Pixel 11 files and firmware.
 */

import { bundleSegment } from "./bundle.ts";
import { type McfHeader, type McfKind, readContainer } from "./container.ts";
import { McfError } from "./errors.ts";
import { type McfItemRecord, readItemRecords } from "./items.ts";
import { readItemTable, type ItemTable } from "./layout.ts";

export { McfError } from "./errors.ts";
export type { McfCondition, McfItemRecord, PlmnCondition } from "./items.ts";
export {
	readItemTable,
	type FormulaTerm,
	type ItemLayout,
	type ItemTable,
	type ItemWidth,
	type LidGroup,
} from "./layout.ts";
export { sbpOperator } from "./sbp.ts";
export { ITEM_UNITS, nameOf, shapeOf, shapesFor, type ItemShape, type ItemShapes } from "./shapes.ts";
export { readValue, type McfValue } from "./values.ts";

export interface McfFile {
	readonly header: McfHeader;
	readonly records: readonly McfItemRecord[];
}

/** Throws McfError, or BoundsError on truncation. */
function decodeAs(bytes: Uint8Array, kind: McfKind): McfFile {
	const { kind: found, header, bodies } = readContainer(bytes);
	if (found !== kind) throw new McfError("kind", 0x14, `expected an ${kind} file`);
	return { header, records: bodies.flatMap((section) => readItemRecords(section, header.lids)) };
}

/** `.mcfopota`: per-operator settings, each record conditioned on `<sbp>_<mcc>_<mnc>`. */
export function decodeOpOta(bytes: Uint8Array): McfFile {
	return decodeAs(bytes, "OP-OTA");
}

/** `.mcfnwota`: per-operator network settings, laid out like OP-OTA. */
export function decodeNwOta(bytes: Uint8Array): McfFile {
	return decodeAs(bytes, "NW-OTA");
}

/** `.mcfota`: settings for every SIM, laid out like OP-OTA with unconditioned records. */
export function decodeOta(bytes: Uint8Array): McfFile {
	return decodeAs(bytes, "OTA");
}

/** The item table of an uncompressed `md/modem-bundle.img` as it streams: only its md1rom segment is held, and nothing after it read. */
export async function bundleItemTable(bundle: AsyncIterable<Uint8Array>): Promise<ItemTable> {
	return readItemTable(await bundleSegment(bundle, "md1rom"));
}
