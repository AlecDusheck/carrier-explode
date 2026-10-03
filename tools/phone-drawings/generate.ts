/**
 * Writes static/phones/: a drawing per measured iPhone and Pixel, and each
 * family's plain fallback. `--check` writes nothing and fails on any file
 * that differs from what it would write.
 *
 *   node tools/phone-drawings/generate.ts [--check]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { PIXELS } from "../../src/lib/pixels.ts";
import { IPHONES } from "./iphones.ts";
import { PIXEL_SHAPES } from "./pixels.ts";
import { renderPlain, renderShape } from "./render.ts";
import type { PhoneShape } from "./shape.ts";

const OUT = new URL("../../static/phones/", import.meta.url);

const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });

const pixelSlugs = new Set(Object.values(PIXELS).map((p) => p.slug));
const unmatched = [
  ...[...pixelSlugs].filter((s) => !Object.hasOwn(PIXEL_SHAPES, s)),
  ...Object.keys(PIXEL_SHAPES).filter((s) => !pixelSlugs.has(s)),
];
if (unmatched.length) throw new Error(`Pixels without both a table entry and a shape: ${unmatched.join(", ")}`);

const shapes: ReadonlyArray<readonly [string, PhoneShape]> = [...Object.entries(IPHONES), ...Object.entries(PIXEL_SHAPES)];
const files = new Map<string, string>([
  ...shapes.map(([slug, shape]) => [`${slug}.svg`, renderShape(shape)] as const),
  ["iphone.svg", renderPlain("iphone")],
  ["pixel.svg", renderPlain("pixel")],
]);

const differing: string[] = [];
for (const [name, svg] of files) {
  const url = new URL(name, OUT);
  if (!values.check) writeFileSync(url, svg);
  else if (readExisting(url) !== svg) differing.push(name);
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
