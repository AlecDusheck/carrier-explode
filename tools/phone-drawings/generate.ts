/**
 * Writes each measured iPhone (by model) and Pixel (by codename) to src/lib/drawings/, and each family's fallback
 * to static/phones/; `--check` instead fails on any file that differs.
 *   pnpm --filter @carrier-explode/phone-drawings generate [--check]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { IPHONES } from "./iphones.ts";
import { PIXEL_SHAPES } from "./pixels.ts";
import { renderPlain, renderShape } from "./render.ts";
import type { PhoneShape } from "./shape.ts";

const DRAWINGS = new URL("../../apps/site/src/lib/drawings/", import.meta.url);
const OUTLINES = new URL("../../apps/site/static/phones/", import.meta.url);

const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });

const shapes: ReadonlyArray<readonly [string, PhoneShape]> = [
	...Object.entries(IPHONES),
	...Object.entries(PIXEL_SHAPES),
];
const files = new Map<URL, string>([
	...shapes.map(([name, shape]) => [new URL(`${name}.svg`, DRAWINGS), renderShape(shape)] as const),
	[new URL("iphone.svg", OUTLINES), renderPlain("iphone")],
	[new URL("pixel.svg", OUTLINES), renderPlain("pixel")],
]);

const differing: string[] = [];
for (const [url, svg] of files) {
	if (!values.check) writeFileSync(url, svg);
	else if (readExisting(url) !== svg) differing.push(url.pathname);
}
if (differing.length) throw new Error(`Differs from the generator: ${differing.join(", ")}`);
console.log(`${values.check ? "Checked" : "Wrote"} ${files.size} drawings.`);

function readExisting(url: URL): string | undefined {
	try {
		return readFileSync(url, "utf8");
	} catch (e) {
		if (e instanceof Error && "code" in e && e.code === "ENOENT") return undefined;
		throw e;
	}
}
