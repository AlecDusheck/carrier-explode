/**
 * Writes apps/site/src/lib/marks/ios/ and android/: each release's mark and each family's fallback.
 * `--check` instead fails on any file that differs.
 *   node tools/version-marks/generate.ts [--check]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ANDROID, IOS } from "./families.ts";
import type { Family } from "./mark.ts";
import { renderFallback, renderMark, renderPlain } from "./render.ts";

const MARKS = new URL("../../apps/site/src/lib/marks/", import.meta.url);

const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });

function files(family: Family): Array<readonly [string, string]> {
	return [
		...Object.entries(family.marks).map(
			([major, mark]) => [`${major}.svg`, renderMark(mark, Number(major), family.font)] as const,
		),
		...family.plain.map((major) => [`${major}.svg`, renderPlain(major, family.font)] as const),
		[family.fallback, renderFallback()],
	];
}

const out = [IOS, ANDROID].flatMap((family) =>
	files(family).map(([name, svg]) => [new URL(`${family.dir}/${name}`, MARKS), svg] as const),
);

const differing: string[] = [];
for (const [url, svg] of out) {
	if (!values.check) writeFileSync(url, svg);
	else if (readExisting(url) !== svg) differing.push(url.pathname);
}
if (differing.length) throw new Error(`Differs from the generator: ${differing.join(", ")}`);
console.log(`${values.check ? "Checked" : "Wrote"} ${out.length} marks.`);

function readExisting(url: URL): string | undefined {
	try {
		return readFileSync(url, "utf8");
	} catch (e) {
		if (e instanceof Error && "code" in e && e.code === "ENOENT") return undefined;
		throw e;
	}
}
