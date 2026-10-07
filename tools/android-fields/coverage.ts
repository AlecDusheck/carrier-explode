/**
 * Share of config keys in real CarrierSettings files that fields.ts documents.
 *   pnpm --filter @carrier-explode/android-fields coverage <dir of *.pb> [--missing]
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
	configDoc,
	decodeCarrierSettings,
	splitMultiCarrierSettings,
	type CarrierConfigValue,
	type CarrierSettings,
} from "@carrier-explode/decode-android";

/** Uses per key. */
type Tally = Map<string, number>;

function tallyAll(configs: Readonly<Record<string, CarrierConfigValue>>, t: Tally): void {
	for (const [key, value] of Object.entries(configs)) {
		t.set(key, (t.get(key) ?? 0) + 1);
		if (value.kind === "bundle") tallyAll(value.value, t);
	}
}

/** Bundle members are mostly data keyed by RAT numbers or MCCMNCs, not config keys, so they are tallied apart. */
function walk(configs: Readonly<Record<string, CarrierConfigValue>>, top: Tally, nested: Tally): void {
	for (const [key, value] of Object.entries(configs)) {
		top.set(key, (top.get(key) ?? 0) + 1);
		if (value.kind === "bundle") tallyAll(value.value, nested);
	}
}

function settingsIn(dir: string, file: string): readonly CarrierSettings[] {
	const bytes = readFileSync(join(dir, file));
	return file === "others.pb"
		? splitMultiCarrierSettings(bytes).settings.map(decodeCarrierSettings)
		: [decodeCarrierSettings(bytes)];
}

const pct = (a: number, b: number): string => `${b ? ((100 * a) / b).toFixed(1) : "0"}%`;

function report(label: string, t: Tally, missing: boolean): void {
	const keys = [...t];
	const documented = keys.filter(([k]) => configDoc(k) !== undefined);
	const uses = keys.reduce((n, [, c]) => n + c, 0);
	const documentedUses = documented.reduce((n, [, c]) => n + c, 0);
	process.stdout.write(
		`${label}: ${documented.length}/${keys.length} distinct keys documented (${pct(documented.length, keys.length)}), ` +
			`${documentedUses}/${uses} uses (${pct(documentedUses, uses)})\n`,
	);
	if (!missing) return;
	for (const [k, c] of keys.filter(([key]) => configDoc(key) === undefined).toSorted((a, b) => b[1] - a[1]))
		process.stdout.write(`  ${c}\t${k}\n`);
}

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: { missing: { type: "boolean", default: false } },
});
const [dir] = positionals;
if (dir === undefined) throw new Error("usage: coverage.ts <dir of *.pb> [--missing]");
const top: Tally = new Map();
const nested: Tally = new Map();
const files = readdirSync(dir).filter((f) => f.endsWith(".pb") && f !== "carrier_list.pb");
for (const file of files) for (const cs of settingsIn(dir, file)) walk(cs.configs, top, nested);
process.stdout.write(`${files.length} files\n`);
report("top-level keys", top, values.missing);
report("keys inside bundles", nested, values.missing);
