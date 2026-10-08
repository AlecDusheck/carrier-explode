/** Phones by the modem package that serves them, and the iOS bundle files each one reads. */

import {
	compareProducts,
	newestProduct,
	overrideMvnoSet,
	type BundleFile,
} from "@carrier-explode/decode-ios";
import type { BoardRef } from "@carrier-explode/schema";
import type { Named } from "#lib/types.ts";

/** A board a file's name gives, with its phone's name, or the board's own where no device record lists it. */
export type NamedBoard = BoardRef & { readonly name: string };

/** A bundle file or member with the phones its name's boards are. */
export type WithPhones<F> = F & { readonly devices?: readonly NamedBoard[] };

/** A bundle file, an override file with the phones its name's boards are. */
export type PhoneFile = WithPhones<BundleFile>;

/** Nothing names a phone that reads as its code. */
const isNamed = (p: Named): boolean => p.name !== p.code;

/** Named phones in name order, then unnamed ones by product type. */
export function sortPhones<P extends Named>(phones: readonly P[]): P[] {
	const named = phones
		.filter(isNamed)
		.toSorted((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
	return [...named, ...phones.filter((p) => !isNamed(p)).toSorted((a, b) => compareProducts(a.code, b.code))];
}

/** "iPhone 17, 17 Pro, 17 Pro Max": each name once, the shared "iPhone " said once. */
export function phoneList(phones: readonly Named[]): string {
	const names = [...new Set(sortPhones(phones).map((p) => p.name))];
	return names.map((n, i) => (i && n.startsWith("iPhone ") ? n.slice(7) : n)).join(", ");
}

/** The release an OTA-only version is read against: the newest public one, else the newest beta while none is indexed. */
export const readAgainst = <R extends { readonly id: string; readonly prerelease?: boolean }>(
	newestFirst: readonly R[],
): R | undefined => newestFirst.find((r) => !r.prerelease) ?? newestFirst[0];

export const newestNamed = (phones: readonly Named[]): string | undefined =>
	phones.filter(isNamed).toSorted((a, b) => compareProducts(b.code, a.code))[0]?.name;

type FileRef = Pick<PhoneFile, "kind" | "devices">;

/** A bundle file that is a modem override (.der.pri, plain .pri or .der.tri). */
export const isPri = (f: Pick<BundleFile, "kind">): boolean =>
	f.kind === "pri-der" || f.kind === "pri-plain" || f.kind === "tri-der";

/** The bundle's modem override files for one phone, by the boards in their `overrides_<stem>` names. */
export const overridesFor = <F extends FileRef>(files: readonly F[], productType: string): F[] =>
	files.filter((f) => isPri(f) && f.devices?.some((d) => d.product === productType));

/** Whether a copy was made once `productType` existed: an override file names it or a newer model. */
export const knowsPhone = (files: readonly FileRef[], productType: string): boolean =>
	files.some(
		(f) =>
			isPri(f) &&
			f.devices?.some((d) => d.product !== undefined && compareProducts(d.product, productType) >= 0),
	);

/** An override file's boards that name no phone the device records list: a board newer than the records. */
const unknownBoards = (f: Pick<PhoneFile, "devices">): string[] =>
	(f.devices ?? []).filter((d) => d.product === undefined).map((d) => d.board);

const namesNoPhone = (f: FileRef): boolean => isPri(f) && !f.devices?.some((d) => d.product);

/** Modem files named for no phone: global_setting_*.der.gri, an MVNO set. Not a board the records have yet to list. */
export const sharedPri = <F extends FileRef>(files: readonly F[]): F[] =>
	files.filter((f) => namesNoPhone(f) && !unknownBoards(f).length);

/** Modem files named only for boards the device records do not list yet, each shown as its board code. */
const unrecognisedPri = <F extends FileRef>(files: readonly F[]): F[] =>
	files.filter((f) => namesNoPhone(f) && unknownBoards(f).length > 0);

/** A phone with the modem generation it runs, where the release says. */
export type GroupPhone = Named & { readonly family?: Named };

/** One phone group in a bundle version: the modem override file it reads, or carrier.plist alone. */
export type PhoneRow =
	| {
			readonly kind: "file";
			/** The version the file is read from. */
			readonly slug: string;
			readonly path: string;
			readonly phones: readonly GroupPhone[];
	  }
	| { readonly kind: "defaults"; readonly phones: readonly GroupPhone[] };

export type FileRow = Extract<PhoneRow, { readonly kind: "file" }>;

/** What `?file=` names a row by: its override file, or carrier.plist for the phones that read only that. */
export const rowKey = (r: PhoneRow): string => (r.kind === "file" ? r.path : "carrier.plist");

/** The phones a file's boards name, where the device records list them. */
const namedPhones = (f: Pick<PhoneFile, "devices">): GroupPhone[] =>
	(f.devices ?? []).flatMap((d) => (d.product === undefined ? [] : [{ code: d.product, name: d.name }]));

const newestIn = (f: PhoneRow): string => newestProduct(f.phones.map((p) => p.code)) ?? "";
/** The carrier's own file (0) before its MVNO sets'. */
const mvnoSetOf = (r: PhoneRow): number => (r.kind === "file" ? (overrideMvnoSet(r.path) ?? 0) : 0);

/**
 * Phones newest first, those the release lacks too (an OTA version's files for older phones), with the release's
 * phones that read carrier.plist alone; then files for boards the device records lack, then files named for none
 * (global_setting_*, MVNO sets).
 */
export function phoneRows(
	slug: string,
	files: ReadonlyArray<Pick<PhoneFile, "kind" | "devices" | "path">>,
	ov: { readonly files: readonly FileRow[]; readonly defaults: readonly GroupPhone[] } | null,
): PhoneRow[] {
	const read = new Set(ov?.files.map((r) => r.path));
	const outside = files.filter((f) => isPri(f) && !read.has(f.path) && namedPhones(f).length);
	const phones: PhoneRow[] = [
		...(ov?.files ?? []),
		...outside.map((f): FileRow => ({ kind: "file", slug, path: f.path, phones: namedPhones(f) })),
		...(ov?.defaults.length ? [{ kind: "defaults" as const, phones: ov.defaults }] : []),
	];
	return [
		...phones.toSorted((x, y) => compareProducts(newestIn(y), newestIn(x)) || mvnoSetOf(x) - mvnoSetOf(y)),
		...unrecognisedPri(files).map((f): FileRow => ({
			kind: "file",
			slug,
			path: f.path,
			phones: unknownBoards(f).map((code) => ({ code, name: `Unrecognised phone (${code})` })),
		})),
		...sharedPri(files).map((f): FileRow => ({ kind: "file", slug, path: f.path, phones: [] })),
	];
}

/**
 * The row a `?file=` selection names, else the newest phone with a file of its own. `missing`: a named file no phone
 * in this version reads, so the page can say so rather than quietly show another phone.
 */
export function pickPhoneRow(
	rows: readonly PhoneRow[],
	file: string | null,
): { row: PhoneRow | undefined; missing: string | undefined } {
	const named = file ? rows.find((r) => rowKey(r) === file) : undefined;
	return {
		row: named ?? rows.find((r) => r.kind === "file") ?? rows[0],
		missing: file && !named ? file : undefined,
	};
}

/** One side of a comparison: its version's rows and the file its query names. */
export interface PhoneSide {
	readonly rows: readonly PhoneRow[];
	readonly file: string | null;
}

const namedRow = (s: PhoneSide): PhoneRow | undefined =>
	s.file ? s.rows.find((r) => rowKey(r) === s.file) : undefined;

const phoneCodes = (rows: readonly PhoneRow[]): Set<string> =>
	new Set(rows.flatMap((r) => r.phones.map((p) => p.code)));

/**
 * Each side's row: the one its query names, else the row of the newest phone both sides can be seen by, so the diff
 * is one phone's; a side's own newest only when they share none.
 */
export function pickPhoneRows(
	a: PhoneSide,
	b: PhoneSide,
): readonly [PhoneRow | undefined, PhoneRow | undefined] {
	const [na, nb] = [namedRow(a), namedRow(b)];
	const theirs = phoneCodes(nb ? [nb] : b.rows);
	const shared = newestProduct([...phoneCodes(na ? [na] : a.rows)].filter((c) => theirs.has(c)));
	const pick = (s: PhoneSide, row: PhoneRow | undefined): PhoneRow | undefined =>
		row ?? s.rows.find((r) => r.phones.some((p) => p.code === shared)) ?? s.rows[0];
	return [pick(a, na), pick(b, nb)];
}

/** One phone picker choice: the phones it covers, pictured by the newest. */
export interface PhoneChoice {
	readonly key: string;
	readonly label: string;
	readonly id: string | undefined;
	readonly name: string | undefined;
	readonly href: string;
}

/** A row's phones, and what sets its files apart: an MVNO set's, or carrier.plist alone. */
export function rowName(r: PhoneRow): string {
	if (r.kind === "defaults") return `${phoneList(r.phones)} · carrier.plist only`;
	if (!r.phones.length) return `${r.path} (not named for a phone)`;
	const mvno = overrideMvnoSet(r.path);
	return `${phoneList(r.phones)}${mvno === null ? "" : ` · MVNO set ${mvno}`}`;
}

/** The modems a row's phones run, where the release says. */
export const rowModems = (r: PhoneRow): string =>
	[...new Set(r.phones.flatMap((p) => p.family?.name ?? []))].join(", ");

function choiceLabel(r: PhoneRow): string {
	const modems = r.kind === "file" ? rowModems(r) : "";
	return `${rowName(r)}${modems ? ` · ${modems}` : ""}`;
}

/** An Apple version's phone rows as phone picker choices; picking one sets `?file=`. */
export function fileChoices(rows: readonly PhoneRow[], href: (key: string) => string): PhoneChoice[] {
	return rows.map((r) => ({
		key: rowKey(r),
		label: choiceLabel(r),
		id: r.phones.toSorted((a, b) => compareProducts(b.code, a.code))[0]?.code,
		name: newestNamed(r.phones),
		href: href(rowKey(r)),
	}));
}
