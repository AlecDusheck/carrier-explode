/**
 * MediaTek Pixel 11: each SBP's OP-OTA, with its NW-OTA when there is one, from the modem image's MCF directory, and
 * the shapes of their items from that build's md1rom item table.
 */

import { compareUtf8 } from "@carrier-explode/binary";
import {
	bundleItemTable,
	decodeNwOta,
	decodeOpOta,
	sbpOperator,
	shapesFor,
	type ItemTable,
	type McfItemRecord,
	type PlmnCondition,
} from "@carrier-explode/decode-mediatek";
import type { Filesystem } from "@carrier-explode/firmware";
import {
	gunzipped,
	jsonBytes,
	listed,
	ModemExtractError,
	tensorLabel,
	uniqueLabels,
	type ExtractedModem,
	type ModemArchive,
	type ModemImages,
} from "./archive.ts";

const OP_OTA = /^MTK_OPOTA_SBPID_(\d+)\.mcfopota$/;
const nwOtaName = (sbp: number): string => `MTK_NWOTA_SBPID_${sbp}.mcfnwota`;

type SbpPlmn = { readonly mcc: string; readonly mnc: string | null };

/** The PLMNs an OP-OTA's conditions name, distinct and sorted; conditions on any MCC name none. */
function plmns(records: readonly McfItemRecord[]): SbpPlmn[] {
	const conditions = records.flatMap((r): PlmnCondition[] => {
		const c = r.condition;
		if (c.kind === "plmn") return [c];
		return c.kind === "segments" ? c.segments.flatMap((s) => (s.kind === "plmn" ? [s] : [])) : [];
	});
	const byKey = new Map<string, SbpPlmn>();
	for (const { mcc, mnc } of conditions) if (mcc !== null) byKey.set(`${mcc}-${mnc ?? ""}`, { mcc, mnc });
	return [...byKey].toSorted(([a], [b]) => compareUtf8(a, b)).map(([, p]) => p);
}

const sbpLabel = (id: number, operator: string | null): string =>
	operator === null ? `SBP ${id}` : `SBP ${id} (${operator})`;

/** The inflated bundle outgrows a step: only its leading md1rom segment is read and held. */
async function itemTable(modem: Filesystem, label: string): Promise<ItemTable> {
	return bundleItemTable(gunzipped(modem.readStream(`images/${label}/md/modem-bundle.img.gz`)));
}

export async function mediatekModem(images: ModemImages): Promise<ExtractedModem> {
	const label = await tensorLabel(images.modem);
	const dir = `images/${label}/mcf/mtk_default`;
	const entries = await listed(images.modem, dir);
	if (!entries) throw new ModemExtractError(`modem/${dir}: missing`);
	const table = await itemTable(images.modem, label);
	const names = new Set(entries.filter((e) => e.kind === "file").map((e) => e.name));
	const ops = [...names]
		.flatMap((name) => {
			const id = OP_OTA.exec(name)?.[1];
			return id === undefined ? [] : [{ name, id: Number(id) }];
		})
		.toSorted((a, b) => a.id - b.id);
	const archives: ModemArchive[] = [];
	for (const { name, id } of ops) {
		const op = await images.modem.readFile(`${dir}/${name}`);
		const opRecords = decodeOpOta(op).records;
		const operator = sbpOperator(id)?.name ?? null;
		const files = new Map<string, Uint8Array>([
			["op.mcfopota", op],
			["sbp.json", jsonBytes({ id, operator, plmns: plmns(opRecords) })],
		]);
		let nwRecords: readonly McfItemRecord[] = [];
		if (names.has(nwOtaName(id))) {
			const nw = await images.modem.readFile(`${dir}/${nwOtaName(id)}`);
			nwRecords = decodeNwOta(nw).records;
			files.set("nw.mcfnwota", nw);
		}
		files.set("items.json", jsonBytes({ build: label, ...shapesFor(table, [...opRecords, ...nwRecords]) }));
		archives.push({ label: sbpLabel(id, operator), path: `modem/${dir}/${name}`, files: async () => files });
	}
	return { family: "mediatek", firmware: label, archives: uniqueLabels(archives) };
}
