/** Which phones read which of an Apple bundle's modem override files, and how each phone's files changed between versions. */

import {
	comparable,
	decodeFile,
	decodedPlist,
	isJsonDict,
	newestProduct,
	overrideMvnoSet,
	type BundleFile,
} from "@carrier-explode/decode-ios";
import type { TimelineEntry } from "@carrier-explode/schema";
import { diffValues, summariseDiff, type DiffCounts, type DiffRow } from "@carrier-explode/values";
import {
	isPri,
	knowsPhone,
	overridesFor,
	phoneRows,
	readAgainst,
	rowKey,
	type FileRow,
	type GroupPhone,
	type PhoneFile,
	type PhoneRow,
} from "#lib/apple/phones.ts";
import type { Named, Ver } from "#lib/types.ts";
import { cached, perRequest } from "../cache";
import { PHONE_IMAGES, copiesOfEntry, releasesOf, resolve, verFrom, type Located } from "../catalog";
import { mustRelease } from "../releases";
import { decodedMember, describe, open, type Opened } from "./bytes";
import { modemViews, packagesOf } from "./modems";

type FileRef = Pick<PhoneFile, "path" | "kind" | "devices">;
type ReleasePhone = GroupPhone & { readonly family: Named };

/** The release a version is read against: the newest image carrying it, else (an OTA file) readAgainst's. */
async function releaseOf(
	r: Located,
	entry: TimelineEntry,
): Promise<{ readonly build: string; readonly carried: boolean } | null> {
	// Only iPhone images carry modem packages.
	if (PHONE_IMAGES[r.ref.platform] !== "ios") return null;
	const carrying = copiesOfEntry(r.copies, entry)
		.flatMap((c) => (c.kind === "release" ? [c.release] : []))
		.toSorted((a, b) => b.sortKey.localeCompare(a.sortKey));
	const image = carrying[0]?.id;
	if (image) return { build: image, carried: true };
	const newest = readAgainst(await releasesOf("ios"))?.id;
	return newest ? { build: newest, carried: false } : null;
}

interface PhoneCopies {
	readonly entry: TimelineEntry;
	readonly build: string;
	readonly devices: readonly string[];
	readonly modems: Awaited<ReturnType<typeof packagesOf>>;
	readonly phones: readonly ReleasePhone[];
	readonly copies: ReadonlyArray<{ readonly files: readonly FileRef[]; readonly known: boolean }>;
	/** Whether the version serves a phone, so one without an override file reads carrier.plist alone. */
	readonly knows: (productType: string) => boolean;
}

/** Every phone of a version's release, newest family first, with its override files in that version. */
const phoneCopiesOnce = perRequest(
	async (source: string, line: string, slug: string): Promise<PhoneCopies | null> => {
		const described = await describe(verFrom(source, line, slug));
		const { entry, files } = described;
		const read = await releaseOf(described, entry);
		if (!read) return null;
		const { build } = read;
		const [release, modems, views] = await Promise.all([
			mustRelease("ios", build),
			packagesOf(build),
			modemViews(build),
		]);
		// An image's copy holds the files of the phones it lists and no others; an OTA file's age is guessed from its files.
		const knows = (code: string): boolean =>
			read.carried ? release.devices.includes(code) : knowsPhone(files, code);
		const phones = views.flatMap((m) => m.devices.map((d) => ({ ...d, family: m.family })));
		const copies = phones.map((p) => {
			// oxlint-disable-next-line oxc/no-map-spread -- the spreads only leave out absent optional fields; nothing is copied.
			const mine = overridesFor(files, p.code).map(({ path, kind, devices }): FileRef => ({
				path,
				kind,
				...(devices ? { devices } : {}),
			}));
			return { files: mine, known: mine.length > 0 || knows(p.code) };
		});
		return { entry, build, devices: release.devices, modems, phones, copies, knows };
	},
);
export const phoneCopies = (v: Ver): Promise<PhoneCopies | null> =>
	phoneCopiesOnce(v.source, v.line ?? "", v.slug ?? "");

export interface BundleOverrides {
	readonly build: string;
	readonly files: readonly FileRow[];
	/** Phones the version serves that have no override file: they read carrier.plist alone. */
	readonly defaults: readonly ReleasePhone[];
}

/** A version's modem override files, each with the phones that read it, and the phones that read none. Phones it does not serve are left out. */
export async function getBundleOverrides(at: Ver): Promise<BundleOverrides | null> {
	const v = await phoneCopies(at);
	if (!v) return null;
	const files = new Map<string, { kind: "file"; slug: string; path: string; phones: ReleasePhone[] }>();
	const defaults: ReleasePhone[] = [];
	v.phones.forEach((p, i) => {
		const c = v.copies[i];
		if (!c?.files.length) {
			if (c?.known) defaults.push(p);
			return;
		}
		for (const f of c.files) {
			const row = files.get(f.path) ?? { kind: "file", slug: v.entry.slug, path: f.path, phones: [] };
			row.phones.push(p);
			files.set(f.path, row);
		}
	});
	return { build: v.build, files: [...files.values()], defaults };
}

/** An override file present in both versions, diffed. */
export interface ComparedFile {
	readonly kind: "same" | "changed";
	readonly path: string;
	readonly before: string;
	readonly counts: DiffCounts;
	readonly rows: readonly DiffRow[];
	readonly truncated: boolean;
}

/** One override file of a phone group, against what that phone had before. */
export type PhoneFileChange =
	| { readonly kind: "added"; readonly path: string }
	| { readonly kind: "removed"; readonly before: string }
	| ComparedFile;

export interface PhoneChange {
	/** The phone row as the version's pickers offer it. */
	readonly row: PhoneRow;
	/**
	 * "compared": the version compared against has files for these phones. "new": it was made while the phone
	 * existed and gave it none (carrier.plist alone). "absent": it does not serve the phone (an image for other phones, or older).
	 */
	readonly status: "compared" | "new" | "absent";
	readonly plist: PhoneFileChange | null;
	readonly modem: PhoneFileChange | null;
}

type FileChanges = Pick<PhoneChange, "plist" | "modem"> & { readonly compared: boolean };

const PHONE_ROWS = 300;
const isPhonePlist = (f: Pick<BundleFile, "path">): boolean => /^overrides_.+\.plist$/.test(f.path);

/** A phone's override files in a copy, by the boards in their names; a board no device record lists goes by its own code. */
const filesFor = (o: Opened, phone: string): PhoneFile[] =>
	o.files.filter((f) => f.devices?.some((d) => (d.product ?? d.board) === phone));

function fileChange(
	A: Opened | null,
	before: string | undefined,
	B: Opened,
	path: string | undefined,
): PhoneFileChange | null {
	if (!path) return before ? { kind: "removed", before } : null;
	if (!A || !before) return { kind: "added", path };
	const rows = diffValues(
		comparable(decodeFile(A.opened, before)),
		comparable(decodeFile(B.opened, path)),
		isJsonDict,
	);
	return {
		kind: rows.length ? "changed" : "same",
		path,
		before,
		counts: summariseDiff(rows),
		rows: rows.slice(0, PHONE_ROWS),
		truncated: rows.length > PHONE_ROWS,
	};
}

/**
 * Each phone row the version's pickers offer, in their order: its override plist and modem file against what its
 * newest phone had before. Per phone, as file by file a phone moving to another group's file would read as one
 * removed and another added.
 */
export async function getPhoneChanges(v: Ver, against?: string): Promise<PhoneChange[] | null> {
	const { entry: b, previous } = await resolve(v);
	const a = against ? (await resolve({ ...v, slug: against })).entry : previous;
	if (!a) return null;
	const [ov, va, described] = await Promise.all([
		getBundleOverrides(v),
		phoneCopies({ ...v, slug: a.slug }),
		describe(v),
	]);
	if (!ov || !va) return null;
	const rows = phoneRows(b.slug, described.files, ov).flatMap((row) => {
		const lead = newestProduct(row.phones.map((p) => p.code)) ?? row.phones[0]?.code;
		return lead === undefined ? [] : [{ row, lead }];
	});
	// Cached by phone code: the names are the index's, which a publish can change under the same bundles.
	const changes = await cached(
		`phonechanges:v7:${b.sha}|${a.sha}|${rows.map(({ row, lead }) => `${rowKey(row)}:${lead}`).join(",")}`,
		async () => {
			const [A, B] = await Promise.all([open({ ...v, slug: a.slug }), open(v)]);
			return rows.map(({ row, lead }): FileChanges => {
				// An MVNO set's file is compared with the same set's, the carrier's own with its own.
				const set = row.kind === "file" ? overrideMvnoSet(row.path) : null;
				const before = filesFor(A, lead).filter((f) => overrideMvnoSet(f.path) === set);
				const after =
					row.kind === "file"
						? B.files.filter((f) => f.path === row.path || f.path === overridePlistOf(row.path))
						: [];
				const had = before.length ? A : null;
				return {
					compared: before.length > 0,
					plist: fileChange(had, before.find(isPhonePlist)?.path, B, after.find(isPhonePlist)?.path),
					modem: fileChange(had, before.find(isPri)?.path, B, after.find(isPri)?.path),
				};
			});
		},
	);
	return rows.flatMap(({ row, lead }, i): PhoneChange[] => {
		const c = changes[i];
		if (!c) return [];
		const status = c.compared ? "compared" : va.knows(lead) ? "new" : "absent";
		return [{ row, status, plist: c.plist, modem: c.modem }];
	});
}

export interface OverridePlist {
	readonly path: string;
	readonly plist: Readonly<Record<string, unknown>>;
}

/** A phone's override plist, beside its modem override file. */
export const overridePlistOf = (priPath: string): string => priPath.replace(/(\.der)?\.pri$/, ".plist");

/** A phone's override plist next to its modem file (same stem), decoded; null when the copy has none. */
export async function getOverridePlist(v: Ver, priPath: string): Promise<OverridePlist | null> {
	const path = overridePlistOf(priPath);
	if (!(await describe(v)).facts.info.files.some((f) => f.path === path)) return null;
	const plist = decodedPlist(await decodedMember(v, path));
	return isJsonDict(plist) ? { path, plist } : null;
}
