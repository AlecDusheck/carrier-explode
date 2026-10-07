/** Keyed collections and two bundles, file by file, diffed with values' structural diff. */

import { decodeFile, deviceStem, type DecodedFile, type OpenedBundle } from "./bundle.ts";
import {
	diffValues,
	summariseDiff,
	type DiffCounts,
	type DiffKind,
	type DiffRow,
} from "@carrier-explode/values";
import { isJsonDict } from "./plist.ts";
import type { PriDecoded } from "./pri.ts";
import type { TriDecoded } from "./tri.ts";

function byKey<T>(xs: T[], key: (x: T) => string, val: (x: T) => unknown): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const x of xs) {
		const k = key(x);
		out[k] = k in out ? [out[k], val(x)].flat() : val(x);
	}
	return out;
}

/** A PRI keyed by setting name/path, so a moved setting is not reported as changed. */
function priComparable(p: PriDecoded): Record<string, unknown> {
	return {
		header: p.header,
		named: byKey(
			p.named,
			(x) => x.name,
			(x) => x.value.text,
		),
		efs: byKey(
			p.efs,
			(x) => x.path,
			(x) => x.value.text,
		),
		featureGroups: byKey(
			p.featureGroups,
			(x) => x.name,
			(x) => x.bits,
		),
		nvItems: p.nvItems,
		schema: p.schema.paths,
		unknown: byKey(
			p.unknown,
			(x) => x.tag,
			(x) => x.hex,
		),
	};
}

/** A Qualcomm-phone .der.tri keyed by record path; a PLMN list compares as a set of entries, not by position. */
function triComparable(t: TriDecoded): Record<string, unknown> {
	return Object.fromEntries(
		t.fields.map((f) => {
			switch (f.kind) {
				case "version":
					return [f.path, f.version];
				case "plmn":
					return [f.path, f.plmn];
				case "plmn-list":
					return [f.path, f.plmns];
				case "plmn-act-list":
					return [f.path, Object.fromEntries(f.entries.map((e) => [e.plmn, e.hex]))];
				case "unknown":
					return [f.path, f.hex];
			}
		}),
	);
}

/** What a decoded file is diffed as: its value tree, its PRI settings, its .der.tri records, or its lines. */
export function comparable(d: DecodedFile): unknown {
	if (d.view.type === "pri") return priComparable(d.view.pri);
	if (d.view.type === "tri") return triComparable(d.view.tri);
	if (d.view.type === "tree") return d.view.plist;
	if (d.raw === null) return null;
	return "text" in d.raw ? d.raw.text.split("\n") : d.raw.hex;
}

export interface FileDiff {
	path: string;
	kind: DiffKind;
	rows: DiffRow[];
	counts: DiffCounts;
	/** Rows beyond `maxRows` were dropped. */
	truncated: boolean;
}

export interface BundleDiff {
	files: FileDiff[];
	/** File-level counts. */
	counts: DiffCounts;
	/** Paths present in both bundles. */
	shared: string[];
	/** A path the diff shows in place of each side's own (a phone's override files), with the file it is on each side. */
	aliases: Readonly<Record<string, { readonly a?: string; readonly b?: string }>>;
}

/** Each side's phone, by the boards in its override files' names (deviceStem); null for none. */
export interface PhonePair {
	readonly a: string | null;
	readonly b: string | null;
}

/** How the chosen phones' override files are shown, so the two phones' files are compared with each other. */
const PHONE_STEM = "*";

/** A side's files by the path the diff shows: with phones chosen, only its phone's override files, under PHONE_STEM. */
function shownFiles(o: OpenedBundle, phone: string | null | undefined, phones: boolean): Map<string, string> {
	return new Map(
		o.info.files.flatMap((f): Array<[string, string]> => {
			const stem = deviceStem(f.path);
			if (!phones || stem === undefined) return [[f.path, f.path]];
			return stem === phone ? [[f.path.replace(`overrides_${stem}`, `overrides_${PHONE_STEM}`), f.path]] : [];
		}),
	);
}

/** Key-by-key diff of two keyed collections: a key only on one side is added or removed, one on both is diffed as a value. */
function keyedDiffs(a: Record<string, unknown>, b: Record<string, unknown>, maxRows = 400): FileDiff[] {
	return [...new Set([...Object.keys(a), ...Object.keys(b)])].toSorted().map((path) => {
		const inA = Object.hasOwn(a, path),
			inB = Object.hasOwn(b, path);
		const rows = inA && inB ? diffValues(a[path], b[path], isJsonDict) : [];
		const kind: DiffKind = !inA ? "added" : !inB ? "removed" : rows.length ? "changed" : "same";
		return {
			path,
			kind,
			rows: rows.slice(0, maxRows),
			counts: summariseDiff(rows),
			truncated: rows.length > maxRows,
		};
	});
}

/** Keys whose values match are left out. */
export function diffKeyed(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
	opts: { readonly maxRows?: number } = {},
): FileDiff[] {
	return keyedDiffs(a, b, opts.maxRows).filter((f) => f.kind !== "same");
}

function bytesEqual(x: Uint8Array, y: Uint8Array): boolean {
	if (x.length !== y.length) return false;
	for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
	return true;
}

/** File-by-file diff of bundle `a` (before/left) against `b` (after/right). */
export function compareBundles(
	a: OpenedBundle,
	b: OpenedBundle,
	opts: { readonly path?: string; readonly maxRows?: number; readonly phones?: PhonePair } = {},
): BundleDiff {
	const fa = shownFiles(a, opts.phones?.a, opts.phones !== undefined);
	const fb = shownFiles(b, opts.phones?.b, opts.phones !== undefined);
	const pa = new Set(fa.keys());
	const pb = new Set(fb.keys());
	const all = opts.path ? [opts.path] : [...new Set([...pa, ...pb])].toSorted();
	const counts: DiffCounts = { added: 0, removed: 0, changed: 0, same: 0 };
	// Only files whose bytes differ are decoded; added and removed ones link to the file itself, so their value is never read.
	const va: Record<string, unknown> = {},
		vb: Record<string, unknown> = {};
	for (const path of all) {
		const inA = pa.has(path),
			inB = pb.has(path);
		if (!inA && !inB) continue;
		const ra = fa.get(path) ?? path,
			rb = fb.get(path) ?? path;
		const ea = a.entries[a.prefix + ra],
			eb = b.entries[b.prefix + rb];
		if (inA && inB && ea !== undefined && eb !== undefined && bytesEqual(ea, eb)) {
			counts.same++;
			continue;
		}
		counts[!inA ? "added" : !inB ? "removed" : "changed"]++;
		if (inA) va[path] = inB ? comparable(decodeFile(a, ra)) : null;
		if (inB) vb[path] = inA ? comparable(decodeFile(b, rb)) : null;
	}
	// Bytes that differ make a changed file even when the decoded values match.
	const files = keyedDiffs(va, vb, opts.maxRows);
	for (const f of files) if (f.kind === "same") f.kind = "changed";
	const aliases = Object.fromEntries(
		[...new Set([...pa, ...pb])].flatMap((path) => {
			const ra = fa.get(path),
				rb = fb.get(path);
			return ra === path || rb === path
				? []
				: [[path, { ...(ra === undefined ? {} : { a: ra }), ...(rb === undefined ? {} : { b: rb }) }]];
		}),
	);
	return { files, counts, shared: [...pa].filter((p) => pb.has(p)).toSorted(), aliases };
}
