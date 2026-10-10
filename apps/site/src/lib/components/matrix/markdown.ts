/** The matrix as Markdown: what the page shows for a URL, in words, with a link for each change it offers. */

import { countryName } from "@carrier-explode/schema";
import {
	phoneRules,
	PRESETS,
	presetOf,
	presetRequirements,
	readRequirements,
	requirementParams,
	type Mode,
	type Requirement,
	type Rule,
} from "#lib/feature-matrix.ts";
import { link, withParams } from "#lib/format.ts";
import type { ModelChoice } from "#lib/phones.ts";
import { PLATFORM_NAMES } from "#lib/platforms.ts";
import type { FeatureMatrix } from "#lib/server/features.ts";
import { score, tileTone, TONE_WORDS } from "./score.ts";
import {
	countedColumns,
	metCount,
	MISSES,
	noneShown,
	pickedRules,
	readMiss,
	searched,
	showsEverything,
	shownColumns,
	tally,
	withinMisses,
} from "./view.ts";

export const MARKDOWN_PATH = "/features.md";
const PAGE_PATH = "/features";
/** Every column for this many rows stays well inside a fetch tool's 100 KB. */
export const PAGE_ROWS = 100;

type Changes = Record<string, string | null>;

const escape = (text: string): string => text.replace(/[\\[\]|]/g, "\\$&");
const country = (cc: string): string => countryName(cc) ?? cc;
const list = (items: readonly string[]): string => (items.length ? items.join(" · ") : "none");

function ruleLabel(rule: Rule, param: string): string {
	if (rule.param === null) return rule.name;
	const shown =
		rule.param.kind === "text" ? param : (rule.param.options.find(([v]) => v === param)?.[1] ?? param);
	return `${rule.name} (${shown})`;
}

/** The country with the most carriers, as the search's example. */
function commonCountry(matrix: FeatureMatrix): string | null {
	const counts = new Map<string, number>();
	for (const { entry } of matrix.rows) if (entry.cc) counts.set(entry.cc, (counts.get(entry.cc) ?? 0) + 1);
	const [top] = [...counts].toSorted((a, b) => b[1] - a[1]);
	return top ? country(top[0]) : null;
}

export function matrixMarkdown(matrix: FeatureMatrix, models: readonly ModelChoice[], url: URL): string {
	const params = url.searchParams;
	const to = (text: string, changes: Changes): string =>
		`[${escape(text)}](${url.origin}${withParams(url, { page: null, ...changes })})`;

	const rules = phoneRules(matrix.columns);
	const reqs = readRequirements(params);
	const reqOf = (rule: Rule): Requirement => reqs.get(rule.id) ?? { mode: "off", param: "" };
	const modeOf = (rule: Rule): Mode => reqOf(rule).mode;
	const picked = pickedRules(rules, reqs);
	const everything = showsEverything(params, picked);
	const columns = shownColumns(rules, picked, everything);
	const counted = countedColumns(columns, picked.length);
	const miss = readMiss(params);
	const find = (params.get("q") ?? "").replace(/\s+/g, " ");
	const found = searched(score(matrix.rows, matrix.columns, rules, reqs, country), find);
	const shown = withinMisses(found, miss);
	const preset = presetOf(reqs);
	const phone = matrix.phone;

	const pages = Math.max(1, Math.ceil(shown.length / PAGE_ROWS));
	const at = Math.min(pages, Math.max(1, Number.parseInt(params.get("page") ?? "", 10) || 1));
	const first = (at - 1) * PAGE_ROWS;
	const rows = shown.slice(first, first + PAGE_ROWS);

	const named = (mode: Mode): string[] =>
		rules.flatMap((rule) => (modeOf(rule) === mode ? [ruleLabel(rule, reqOf(rule).param)] : []));
	const moves = (mode: Mode): string =>
		list(
			rules.flatMap((rule) =>
				modeOf(rule) === mode
					? []
					: [to(rule.name, requirementParams(new Map(reqs).set(rule.id, { ...reqOf(rule), mode })))],
			),
		);

	const table = rows.length
		? [
				`| Carrier | Country | Meets | ${columns.map((c) => escape(rules[c]?.name ?? "")).join(" | ")} |`,
				`|${" --- |".repeat(columns.length + 3)}`,
				...rows.map((s) => {
					const e = s.row.entry;
					const name = e.tag ? `${e.brand} (${e.tag})` : e.brand;
					const cells = columns.map((c) => {
						const rule = rules[c];
						return rule ? TONE_WORDS[tileTone(s, c, modeOf(rule))] : "";
					});
					return `| [${escape(name)}](${url.origin}${link(e.path)}) | ${escape(e.cc ? country(e.cc) : "")} | ${metCount(s, counted)}/${counted.length} | ${cells.join(" | ")} |`;
				}),
				"",
				[
					`Carriers ${first + 1}–${first + rows.length} of ${shown.length}.`,
					...(at > 1 ? [to("Previous page", { page: String(at - 1) })] : []),
					...(at < pages ? [to("Next page", { page: String(at + 1) })] : []),
				].join(" "),
			]
		: [noneShown(find)];

	const options = rules.flatMap((rule) => {
		if (modeOf(rule) === "off" || rule.param === null) return [];
		const { param } = reqOf(rule);
		if (rule.param.kind === "text")
			return [`- ${rule.name}: set \`${rule.id}\` to the value to match, now \`${param}\``];
		const others = rule.param.options.filter(([v]) => v !== param);
		const withParam = (v: string): Changes =>
			requirementParams(new Map(reqs).set(rule.id, { ...reqOf(rule), param: v }));
		return [`- ${rule.name}: ${list(others.map(([v, label]) => to(label, withParam(v))))}`];
	});
	const example = commonCountry(matrix);
	const pageSearch = new URLSearchParams(params);
	pageSearch.delete("page");
	const pageHref = `${url.origin}${link(PAGE_PATH)}${pageSearch.size ? `?${pageSearch}` : ""}`;
	const phoneLink = (code: string, text: string): string =>
		code === phone.code ? `**${escape(text)}**` : to(text, { phone: code });
	const platforms = [...new Set(models.map((m) => m.platform))];

	return [
		`# Carrier features on the ${phone.name}`,
		"",
		`${tally(found, picked.length, escape(find), phone.name)}.`,
		"",
		`- Phone: ${phone.name} (\`${phone.code}\`, ${PLATFORM_NAMES[phone.platform]})`,
		`- Preset: ${PRESETS.find((p) => p.id === preset)?.name ?? "Custom"}`,
		`- Required: ${list(named("need"))}`,
		`- Nice to have: ${list(named("want"))}`,
		`- Search: ${find ? `“${escape(find)}”` : "none"}`,
		`- Shown: ${MISSES.find(([m]) => m === miss)?.[1] ?? miss}`,
		`- Columns: ${everything ? "every feature" : "picked features"}`,
		"",
		`Each cell is ${TONE_WORDS.met}, ${TONE_WORDS.offered} (offered; the user turns it on), ${TONE_WORDS.unmet} or ${TONE_WORDS.blank} (no settings for that carrier on this phone). Meets counts the picked features a carrier gives.`,
		"",
		...table,
		"",
		"## Change",
		"",
		`Each link is this view with one thing changed. [The same view as a web page](${pageHref}).`,
		"",
		`- Preset: ${list(PRESETS.flatMap((p) => (p.id === preset ? [] : [to(p.name, { ...requirementParams(presetRequirements(p)), all: null })])))}`,
		`- Require: ${moves("need")}`,
		`- Nice to have: ${moves("want")}`,
		`- Drop: ${moves("off")}`,
		...options,
		`- Shown: ${list(MISSES.flatMap(([m, label]) => (m === miss ? [] : [to(label, { miss: m === "0" ? null : m })])))}`,
		`- Search: ${find ? `${to("clear", { q: null })}, or ` : ""}set \`q\` to a carrier or country${example ? `, e.g. ${to(example, { q: example })}` : ""}`,
		...(picked.length
			? [
					`- Columns: ${everything ? to("picked features", { all: null }) : to("every feature", { all: "1" })}`,
				]
			: []),
		...platforms.map(
			(platform) =>
				`- ${PLATFORM_NAMES[platform]} phones: ${models
					.filter((m) => m.platform === platform)
					.map((m) => {
						const [only, ...more] = m.variants;
						return only && !more.length
							? phoneLink(only.code, m.label)
							: `${escape(m.label)} (${m.variants.map((v) => phoneLink(v.code, v.descriptor ?? v.code)).join(", ")})`;
					})
					.join(" · ")}`,
		),
		"",
	].join("\n");
}
