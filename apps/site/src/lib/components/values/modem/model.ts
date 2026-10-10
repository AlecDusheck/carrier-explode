/** Modem item values read into the shapes their views lay out; undefined when a value is not that shape. */

import type { ModemItem, ModemValue } from "@carrier-explode/schema/types";

type Fields = Readonly<Record<string, ModemValue>>;

const fieldsOf = (v: ModemValue): Fields | undefined => (v.kind === "fields" ? v.fields : undefined);
const numberOf = (v: ModemValue | undefined): number | undefined =>
	v?.kind === "number" ? v.value : undefined;

/** A list of numbers, or one number standing for a list of one. */
function numbersOf(v: ModemValue): number[] | undefined {
	if (v.kind === "number") return [v.value];
	if (v.kind !== "list") return undefined;
	const out = v.values.flatMap((x) => (x.kind === "number" ? [x.value] : []));
	return out.length === v.values.length ? out : undefined;
}

/** `nv:1206/2@3` -> `nv:1206`: an item's index and subscription mask do not change how its value reads. */
export const baseId = (id: string): string => id.replace(/(?:\/\d+)?(?:@\d+)?$/, "");

/** NV 255 and 259: `Sid<n>`/`Nid<n>` pairs; 0/0 is an empty slot. */
export interface SidNid {
	readonly sid: number;
	/** 65535 matches any NID. */
	readonly nid: number | "any";
}

const ANY_NID = 65535;

export function sidNids(v: ModemValue): SidNid[] | undefined {
	const f = fieldsOf(v);
	if (f === undefined) return undefined;
	const out: SidNid[] = [];
	for (let i = 1; Object.hasOwn(f, `Sid${i}`); i++) {
		const [sid, nid] = [numberOf(f[`Sid${i}`]), numberOf(f[`Nid${i}`])];
		if (sid === undefined || nid === undefined) return undefined;
		if (sid !== 0 || nid !== 0) out.push({ sid, nid: nid === ANY_NID ? "any" : nid });
	}
	return out;
}

/** NV 1206: each PPP control protocol's timers and tries, its fields named `<protocol><column>`. */
const PPP_PROTOCOLS = { Lcp: "LCP", Ipcp: "IPCP", Ipv6cp: "IPv6CP" } as const;
const PPP_COLUMN_KEYS = [
	"TermTimeout",
	"AckTimeout",
	"ReqTry",
	"NakTry",
	"TermTry",
	"CompressionEnable",
] as const;
const PPP_COLUMNS = {
	TermTimeout: "Term timeout",
	AckTimeout: "Ack timeout",
	ReqTry: "Req tries",
	NakTry: "Nak tries",
	TermTry: "Term tries",
	CompressionEnable: "Compression",
} as const satisfies Record<(typeof PPP_COLUMN_KEYS)[number], string>;
export const PPP_HEADS: readonly string[] = PPP_COLUMN_KEYS.map((c) => PPP_COLUMNS[c]);

export interface PppProfile {
	/** Cells in PPP_HEADS order. */
	readonly rows: ReadonlyArray<{
		readonly protocol: string;
		readonly cells: ReadonlyArray<number | undefined>;
	}>;
	readonly authRetry: number | undefined;
	readonly authTimeout: number | undefined;
}

export function pppProfile(v: ModemValue): PppProfile | undefined {
	const f = fieldsOf(v);
	if (f === undefined) return undefined;
	const rows = Object.entries(PPP_PROTOCOLS).map(([key, protocol]) => ({
		protocol,
		cells: PPP_COLUMN_KEYS.map((c) => numberOf(f[`${key}${c}`])),
	}));
	if (rows.every((r) => r.cells.every((c) => c === undefined))) return undefined;
	return { rows, authRetry: numberOf(f.AuthRetry), authTimeout: numberOf(f.AuthTimeout) };
}

/** Items whose list is only as long as a count field says: [count field, list field]. */
const COUNTED_LISTS = {
	"nv:7162": ["AllowNumSrvOpt", "AllowSrvOptList"],
	"efs:/nv/item_files/modem/mmode/sd/sdssscr_timers": ["Count", "Value"],
} as const satisfies Readonly<Record<string, readonly [string, string]>>;

const COUNTED: ReadonlyMap<string, readonly [string, string]> = new Map(Object.entries(COUNTED_LISTS));

export interface CountedList {
	readonly list: string;
	readonly values: readonly number[];
	/** A count past the list's capacity, as stored; the list is shown whole. */
	readonly overrun: number | undefined;
	/** The item's other fields, as stored. */
	readonly rest: ReadonlyArray<readonly [string, ModemValue]>;
}

export function countedList(item: ModemItem): CountedList | undefined {
	const pair = COUNTED.get(baseId(item.id));
	const f = fieldsOf(item.value);
	if (pair === undefined || f === undefined) return undefined;
	const [countField, listField] = pair;
	const count = numberOf(f[countField]);
	const list = f[listField] === undefined ? undefined : numbersOf(f[listField]);
	if (count === undefined || list === undefined) return undefined;
	return {
		list: listField,
		values: list.slice(0, count),
		overrun: count > list.length ? count : undefined,
		rest: Object.entries(f).filter(([k]) => k !== countField && k !== listField),
	};
}

/** NV 830: six rows of point-to-point and broadcast routes and memory stores, then one flag. */
const SMS_ROUTE_ROWS = [1, 2, 3, 4, 5, 6] as const;
const SMS_ROUTE_COLUMN_KEYS = ["PPRoutes", "PPMemStores", "BCRoutes", "BCMemStores"] as const;
const SMS_ROUTE_COLUMNS = {
	PPRoutes: "PP routes",
	PPMemStores: "PP mem stores",
	BCRoutes: "BC routes",
	BCMemStores: "BC mem stores",
} as const satisfies Record<(typeof SMS_ROUTE_COLUMN_KEYS)[number], string>;
export const SMS_ROUTE_HEADS: readonly string[] = SMS_ROUTE_COLUMN_KEYS.map((c) => SMS_ROUTE_COLUMNS[c]);

export interface SmsRoutes {
	/** Six rows, cells in SMS_ROUTE_HEADS order. */
	readonly rows: ReadonlyArray<readonly number[]>;
	readonly transferStatusReport: number;
}

export function smsRoutes(v: ModemValue): SmsRoutes | undefined {
	const f = fieldsOf(v);
	const flag = f && numberOf(f.TransferStatusReport);
	if (f === undefined || flag === undefined) return undefined;
	const rows: number[][] = [];
	for (const i of SMS_ROUTE_ROWS) {
		const row = SMS_ROUTE_COLUMN_KEYS.flatMap((c) => numberOf(f[`${c}${i}`]) ?? []);
		if (row.length !== SMS_ROUTE_COLUMN_KEYS.length) return undefined;
		rows.push(row);
	}
	return { rows, transferStatusReport: flag };
}

/** A PLMN packed in a number's low three bytes as BCD: MCC2 MCC1, MNC3 MCC3, MNC2 MNC1. */
export type PackedPlmn =
	| { readonly kind: "plmn"; readonly mcc: string; readonly mnc: string }
	| { readonly kind: "placeholder" };

const PLACEHOLDER = 0x99f999;

export function unpackPlmn(n: number): PackedPlmn {
	const v = n % 0x1000000;
	if (v === PLACEHOLDER) return { kind: "placeholder" };
	const digit = (shift: number): string => ((v >>> shift) & 0xf).toString(16).toUpperCase();
	const mnc3 = digit(12);
	// A two-digit MNC fills its third digit with F.
	return {
		kind: "plmn",
		mcc: digit(16) + digit(20) + digit(8),
		mnc: digit(0) + digit(4) + (mnc3 === "F" ? "" : mnc3),
	};
}

/** Shannon's NR CA PLMN categories: category <n>'s PLMNs, and its name in a sibling item. */
const PLMN_IDS = /^NRCAPA_CA_NV_PLMN_IDS_FOR_PLMN_CATEGORY_ID_(\d+)$/;
const plmnNameItem = (n: string): string => `NRCAPA_CA_NV_PLMN_NAME_FOR_PLMN_CATEGORY_ID_${n}`;

export const isPlmnCategory = (item: ModemItem): boolean => PLMN_IDS.test(item.name ?? "");

/** The names of the items an item's view reads beside it: a PLMN category's name. */
export function itemRefs(item: ModemItem): readonly string[] {
	const n = PLMN_IDS.exec(item.name ?? "")?.[1];
	return n === undefined ? [] : [plmnNameItem(n)];
}

/** Text typed as text by the firmware's registry, or (archives without one) the characters of a NUL-terminated byte list. */
function textOf(v: ModemValue): string | undefined {
	if (v.kind === "text") return v.value;
	const codes = numbersOf(v);
	if (codes === undefined) return undefined;
	const end = codes.indexOf(0);
	return String.fromCharCode(...(end < 0 ? codes : codes.slice(0, end)));
}

export interface PlmnCategory {
	readonly category: string;
	readonly name: string | undefined;
	readonly plmns: readonly PackedPlmn[];
}

export function plmnCategory(item: ModemItem, items: readonly ModemItem[]): PlmnCategory | undefined {
	const n = PLMN_IDS.exec(item.name ?? "")?.[1];
	const plmns = numbersOf(item.value);
	if (n === undefined || plmns === undefined) return undefined;
	const named = items.find((x) => x.name === plmnNameItem(n));
	return { category: n, name: named && textOf(named.value), plmns: plmns.map(unpackPlmn) };
}

/** Shannon values that differ by hardware: `<scope> · hw <key>=<value>/<variant>` fields beside plain `<scope>` ones. */
const HW_KEY = /^(\S+) · (hw .+)$/;

export interface HardwareGrid {
	readonly conditions: readonly string[];
	readonly rows: ReadonlyArray<{ readonly scope: string; readonly cells: HardwareCells }>;
}

/** A scope's one value for all hardware, or its value under each condition. */
type HardwareCells =
	| { readonly kind: "all"; readonly value: ModemValue }
	| { readonly kind: "each"; readonly values: ReadonlyMap<string, ModemValue> };

export function hardwareGrid(v: ModemValue): HardwareGrid | undefined {
	const f = fieldsOf(v);
	if (f === undefined || !Object.keys(f).some((k) => HW_KEY.test(k))) return undefined;
	const conditions = new Set<string>();
	const all = new Map<string, ModemValue>();
	const each = new Map<string, Map<string, ModemValue>>();
	const scopes = new Set<string>();
	for (const [key, value] of Object.entries(f)) {
		const m = HW_KEY.exec(key);
		if (m?.[1] === undefined || m[2] === undefined) {
			all.set(key, value);
			scopes.add(key);
		} else {
			each.set(m[1], (each.get(m[1]) ?? new Map<string, ModemValue>()).set(m[2], value));
			scopes.add(m[1]);
			conditions.add(m[2]);
		}
	}
	return {
		conditions: [...conditions],
		rows: [...scopes].map((scope): HardwareGrid["rows"][number] => {
			const value = all.get(scope);
			return {
				scope,
				cells:
					value === undefined
						? { kind: "each", values: each.get(scope) ?? new Map() }
						: { kind: "all", value },
			};
		}),
	};
}

/** MediaTek MCF arrays: values by array path (`0$1$`), alone or under each condition (`310-410`, `any`). */
const PATH = /^(?:\d+\$)+$/;

const pathFields = (v: ModemValue): Fields | undefined => {
	const f = fieldsOf(v);
	return f !== undefined && Object.keys(f).every((k) => PATH.test(k)) ? f : undefined;
};

const pathIndexes = (path: string): number[] => path.split("$").slice(0, -1).map(Number);

function byPath(a: string, b: string): number {
	const [x, y] = [pathIndexes(a), pathIndexes(b)];
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? -1) - (y[i] ?? -1);
		if (d) return d;
	}
	return 0;
}

export interface McfTable {
	/** The conditions, as columns; empty for an array set unconditionally. */
	readonly conditions: readonly string[];
	readonly rows: ReadonlyArray<{
		readonly path: string;
		readonly cells: ReadonlyArray<ModemValue | undefined>;
	}>;
}

/** `0$1$` -> `[0][1]`. */
export const pathText = (path: string): string =>
	pathIndexes(path)
		.map((i) => `[${i}]`)
		.join("");

export function mcfTable(v: ModemValue): McfTable | undefined {
	const f = fieldsOf(v);
	if (f === undefined) return undefined;
	const alone = pathFields(v);
	const columns: ReadonlyArray<readonly [string, Fields]> | undefined = alone
		? [["", alone]]
		: Object.entries(f).every(([, x]) => pathFields(x) !== undefined)
			? Object.entries(f).flatMap(([c, x]) => {
					const p = pathFields(x);
					return p === undefined ? [] : [[c, p] as const];
				})
			: undefined;
	if (columns === undefined) return undefined;
	const paths = [...new Set(columns.flatMap(([, p]) => Object.keys(p)))].toSorted(byPath);
	if (paths.length * columns.length < 2) return undefined;
	return {
		conditions: alone ? [] : columns.map(([c]) => c),
		rows: paths.map((path) => ({ path, cells: columns.map(([, p]) => p[path]) })),
	};
}
