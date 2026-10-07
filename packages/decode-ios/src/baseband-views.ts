/** Views over a stored baseband summary: where an entry applies, band-combo rows, a keyed form to diff, and what a .der.pri overwrites. */

import type { BandComboSet, BasebandSummary, BasebandTextFile, Variant } from "./baseband-summary.ts";
import { addVariants, byVariant, isTextFile, variantKey } from "./baseband-summary.ts";
import { type ComboStats, parseBandCombos } from "@carrier-explode/decode-qualcomm";
import type { PriDecoded, PriValue } from "./pri.ts";

/** Where a package entry applies: its modem configs, else its platform variants ("5/0/0 5/1/0"). */
export const carriedBy = (f: { variants?: Variant[]; configs?: string[] }): string =>
	f.configs?.length ? f.configs.join(", ") : (f.variants ?? []).map(variantKey).join(" ");

export interface ComboSetRow extends ComboStats {
	/** The first band_combos_per_plmn.xml variant with these numbers. */
	sha1: string;
	/** Every platform whose numbers match. */
	variants: Variant[];
}

/** One carrier tag's stats across combo sets; platforms with identical stats share a row. */
export function mergeComboSets(sets: BandComboSet[], tag: string): ComboSetRow[] {
	const rows = new Map<string, ComboSetRow>();
	for (const set of sets) {
		const hit = set.carriers.find((x) => x.tag === tag);
		if (!hit) continue;
		const { tag: _tag, plmns: _plmns, ...stats } = hit;
		const key = JSON.stringify(stats);
		const row = rows.get(key);
		if (row) addVariants(row.variants, set.variants);
		else rows.set(key, { sha1: set.sha1, variants: [...set.variants].toSorted(byVariant), ...stats });
	}
	return [...rows.values()];
}

/** Each band-combo carrier tag's PLMNs ("310-260"), across every combo set. */
export function comboTagPlmns(sets: BandComboSet[]): Map<string, string[]> {
	const out = new Map<string, Set<string>>();
	for (const c of sets.flatMap((s) => s.carriers)) {
		const plmns = out.get(c.tag) ?? new Set();
		for (const p of c.plmns) plmns.add(p);
		out.set(c.tag, plmns);
	}
	return new Map([...out].map(([tag, plmns]) => [tag, [...plmns]]));
}

/** Section -> keyed parts of a package, so a keyed diff lines two packages up by what each part is. */
export function basebandComparable(s: BasebandSummary): Record<string, Record<string, unknown>> {
	const files: Record<string, unknown> = {};
	for (const f of s.files)
		files[`${f.member} ${f.path} [${carriedBy(f)}]`] = isTextFile(f) ? f.text.split("\n") : f.sha1;
	const combos: Record<string, unknown> = {};
	for (const set of s.bandCombos) {
		const file = s.files.find((f) => f.sha1 === set.sha1);
		const lists = new Map(
			file && isTextFile(file) ? parseBandCombos(file.text).map((c) => [c.tag, c.combos]) : [],
		);
		const at = carriedBy(set);
		for (const { tag, ...stats } of set.carriers)
			combos[`${tag} [${at}]`] = { ...stats, list: [...(lists.get(tag) ?? [])].toSorted() };
	}
	return {
		Package: { package: s.package },
		"Band combos": combos,
		Files: files,
		Power: Object.fromEntries(s.amprNs.map((a) => [`A-MPR NS [${carriedBy(a)}]`, a.groups])),
		"Network databases": Object.fromEntries(
			(s.mdb?.databases ?? []).map((d) => [
				`${d.path} [${carriedBy(d)}]`,
				d.scan ?? d.features ?? d.error ?? d.sha1,
			]),
		),
		"Modem configs": Object.fromEntries(
			(s.modemConfigs ?? []).map((m) => [
				`${m.label ?? "@" + m.offset} ${m.cfgType}`,
				{ version: m.version, trailer: m.trailer, files: m.files },
			]),
		),
		Containers: Object.fromEntries(
			s.containers.map((c) => [
				c.member,
				{ meta: c.meta, records: c.records, blobs: c.blobs, fileTypes: c.fileTypes },
			]),
		),
	};
}

export interface PriReplacement {
	efs: string;
	/** Bytes the .der.pri writes. */
	length: number;
	/** The package files at that path, by index into `files`, and whether the .der.pri writes the same text. */
	baseline: Array<{ i: number; member: string; variants?: Variant[]; configs?: string[]; same: boolean }>;
}

/** The text a PRI EFS entry writes, when it is text. */
export const priText = (v: PriValue): string | undefined =>
	v.kind === "xml" || v.kind === "string" ? v.text : undefined;

/** Package text files a decoded .der.pri overwrites by EFS path; `otherXml` counts its XML at paths the package does not ship. */
export function priReplacements(
	pri: Pick<PriDecoded, "efs">,
	s: BasebandSummary,
): { replaced: PriReplacement[]; otherXml: number } {
	const byPath = new Map<string, Array<{ f: BasebandTextFile; i: number }>>();
	s.files.forEach((f, i) => {
		if (isTextFile(f)) byPath.set(f.path, [...(byPath.get(f.path) ?? []), { f, i }]);
	});
	const replaced: PriReplacement[] = [];
	let otherXml = 0;
	for (const e of pri.efs) {
		const text = priText(e.value);
		if (text === undefined) continue;
		const base = byPath.get(e.path);
		if (!base) {
			if (e.value.kind === "xml") otherXml++;
			continue;
		}
		replaced.push({
			efs: e.path,
			length: e.value.len,
			// oxlint-disable-next-line oxc/no-map-spread -- the spreads only leave out absent optional fields; nothing is copied.
			baseline: base.map(({ f, i }) => ({
				i,
				member: f.member,
				...(f.variants ? { variants: f.variants } : {}),
				...(f.configs ? { configs: f.configs } : {}),
				same: f.text === text,
			})),
		});
	}
	return { replaced, otherXml };
}
