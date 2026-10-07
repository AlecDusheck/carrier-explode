/**
 * NV item and EFS file value layouts from EfsTools' item classes (Items/Nv/Nv.cs, Efs/Efs.cs), kept where Pixel MCFG
 * values have their exact size. A leading Nam or Index field is the item's index byte, read apart, so it is left out.
 */

import { u16le, u32le } from "@carrier-explode/binary";

const NV_FIELD_TYPES = ["u8", "i8", "u16", "i16", "u32"] as const;
type NvFieldType = (typeof NV_FIELD_TYPES)[number];

/** A field: its EfsTools name, its type, and how many follow one another (1 when absent). */
type NvField = readonly [name: string, type: NvFieldType, count?: number];
export type NvLayout = readonly NvField[];

/** A decoded value: each field's number, or its numbers when it repeats. */
export type NvFields = Readonly<Record<string, number | readonly number[]>>;

const WIDTH = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4 } as const satisfies Record<NvFieldType, number>;

const READ = {
	u8: (b, o) => b[o] ?? 0,
	i8: (b, o) => ((b[o] ?? 0) << 24) >> 24,
	u16: (b, o) => u16le(b, o),
	i16: (b, o) => (u16le(b, o) << 16) >> 16,
	u32: (b, o) => u32le(b, o),
} as const satisfies Record<NvFieldType, (b: Uint8Array, o: number) => number>;

/** `name1`..`nameN` pairs, as EfsTools spells repeated pairs out. */
const pairs = (a: string, b: string, n: number): NvField[] =>
	Array.from(
		{ length: n },
		(_, i) =>
			[
				[`${a}${i + 1}`, "u16"],
				[`${b}${i + 1}`, "u16"],
			] as const,
	).flat();

/** Legacy NV items whose class leads with a Nam or Index field, by number, without that field. */
const INDEXED_NV: Readonly<Record<number, NvLayout>> = {
	10: [["Mode", "u16"]],
	34: [["Enabled", "i8", 2]],
	35: [["Enabled", "i8", 2]],
	36: [["Enabled", "i8", 2]],
	176: [["Value", "u16"]],
	177: [["Value", "u8"]],
	255: pairs("Sid", "Nid", 10),
	256: [["Enabled", "u8"]],
	259: pairs("Sid", "Nid", 20),
	260: [["Enabled", "u8"]],
	265: [["Imsi1112", "u8"]],
	285: [
		["EvrcCapabilityEnabled", "u8"],
		["HomePageVoiceSo", "u16"],
		["HomeOrigVoiceSo", "u16"],
		["RoamOrigVoiceSo", "u16"],
	],
	441: [["Band", "i16"]],
	442: [["Roam", "u16"]],
	494: [["TimeDelta", "u32"]],
	848: [["Value", "u16"]],
	849: [["NetSelMode", "u16"]],
	850: [["ServiceDomain", "u16"]],
	854: [["PkoId", "u8"]],
	946: [["Value", "i16"]],
	1014: [
		["ActiveService", "u8"],
		["ServiceFrom", "u16"],
		["ServiceTo", "u16"],
		["Selected", "u8"],
		["Label", "u8", 30],
		["LabelEncoding", "u8"],
		["BcAlert", "u8"],
		["MaxMessages", "u8"],
	],
	1206: [
		["LcpTermTimeout", "u16"],
		["LcpAckTimeout", "u16"],
		["LcpReqTry", "u8"],
		["LcpNakTry", "u8"],
		["LcpTermTry", "u8"],
		["AuthRetry", "u8"],
		["AuthTimeout", "u16"],
		["IpcpTermTimeout", "u16"],
		["IpcpAckTimeout", "u16"],
		["IpcpReqTry", "u8"],
		["IpcpNakTry", "u8"],
		["IpcpTermTry", "u8"],
		["IpcpCompressionEnable", "u8"],
		["Ipv6cpTermTimeout", "u16"],
		["Ipv6cpAckTimeout", "u16"],
		["Ipv6cpReqTry", "u8"],
		["Ipv6cpNakTry", "u8"],
		["Ipv6cpTermTry", "u8"],
		["Ipv6cpCompressionEnable", "u8"],
	],
	2954: [["Band", "u32"]],
};

/** The other legacy NV items, by number. */
const NV: Readonly<Record<number, NvLayout>> = {
	74: [
		["Enable", "u8"],
		["Rings", "u8"],
	],
	75: [
		["Enable", "u8"],
		["Rings", "u8"],
	],
	830: [
		...[1, 2, 3, 4, 5, 6].flatMap(
			(i) =>
				[
					[`PPRoutes${i}`, "u8"],
					[`PPMemStores${i}`, "u8"],
					[`BCRoutes${i}`, "u8"],
					[`BCMemStores${i}`, "u8"],
				] as const,
		),
		["TransferStatusReport", "u8"],
	],
	1897: [
		["InitSolDelay", "u16"],
		["SolInterval", "u16"],
		["ResolInterval", "u16"],
		["MaxSolAttempts", "u16"],
		["MaxResolAttempts", "u16"],
		["PreRaExpResolTime", "u16"],
	],
	5047: [
		["NmeaPortType", "u32"],
		["NmeaReportingType", "u32"],
	],
	6247: [
		["TermTimeout", "u32"],
		["AckTimeout", "u32"],
		["RegTry", "u16"],
		["TermTry", "u16"],
	],
	7147: [
		["EhrpdOnlyFlag", "u8"],
		["MaxFailureCount", "u8"],
		["MaxFailureTotalCount", "u8"],
		["NewAttemptMaxTimer", "u8"],
	],
	7162: [
		["AllowNumSrvOpt", "u16"],
		["AllowSrvOptList", "u16", 62],
	],
};

const EFS: Readonly<Record<string, NvLayout>> = {
	"/nv/item_files/mcfg/mcfg_segload_config": [
		["Version", "u32"],
		["Value", "u32"],
	],
	"/nv/item_files/modem/mmode/get_net_auto_mode": [
		["Version", "u8"],
		["Value", "u16"],
		["Reserved", "u16"],
	],
	"/nv/item_files/modem/mmode/sd/sdssscr_timers": [
		["Version", "u16"],
		["Count", "u16"],
		["Value", "u32", 50],
	],
};

/** A value's fields, and whether an index byte leads it: one the MCFG item may also mark with attribute 0x20. */
export interface ItemLayout {
	readonly indexed: boolean;
	readonly fields: NvLayout;
}

export function itemLayout(key: number | string): ItemLayout | undefined {
	const indexed = typeof key === "number" ? INDEXED_NV[key] : undefined;
	if (indexed !== undefined) return { indexed: true, fields: indexed };
	const fields = typeof key === "number" ? NV[key] : EFS[key];
	return fields === undefined ? undefined : { indexed: false, fields };
}

export const layoutSize = (layout: NvLayout): number =>
	layout.reduce((n, [, type, count = 1]) => n + WIDTH[type] * count, 0);

/** The fields of a value of exactly the layout's size; undefined for any other size. */
export function readLayout(layout: NvLayout, bytes: Uint8Array): NvFields | undefined {
	if (bytes.length !== layoutSize(layout)) return undefined;
	const out: Record<string, number | readonly number[]> = {};
	let o = 0;
	for (const [name, type, count = 1] of layout) {
		const values = Array.from({ length: count }, (_, i) => READ[type](bytes, o + WIDTH[type] * i));
		out[name] = count === 1 && values[0] !== undefined ? values[0] : values;
		o += WIDTH[type] * count;
	}
	return out;
}
