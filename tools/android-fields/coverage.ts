/**
 * How many config keys in real CarrierSettings files have docs in fields.ts.
 *
 *   node tools/android-fields/coverage.ts <dir of *.pb> [--missing]
 *
 * Counts distinct keys (top level, and keys inside bundles separately) and
 * key uses across files. carrier_list.pb is skipped; others.pb is expanded.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  configDoc, decodeCarrierSettings, decodeMultiCarrierSettings,
  type CarrierConfigValue, type CarrierSettings,
} from "../../src/lib/decode/android/index.ts";

interface Tally {
  readonly keys: Map<string, number>;
}

function walk(configs: Readonly<Record<string, CarrierConfigValue>>, top: Tally, nested: Tally, inBundle: boolean): void {
  for (const [key, value] of Object.entries(configs)) {
    const t = inBundle ? nested : top;
    t.keys.set(key, (t.keys.get(key) ?? 0) + 1);
    if (value.type === "bundle") walk(value.value, top, nested, true);
  }
}

function settingsIn(dir: string, file: string): readonly CarrierSettings[] {
  const bytes = readFileSync(join(dir, file));
  return file === "others.pb" ? decodeMultiCarrierSettings(bytes).settings : [decodeCarrierSettings(bytes)];
}

function report(label: string, t: Tally, missing: boolean): void {
  const keys = [...t.keys];
  const documented = keys.filter(([k]) => configDoc(k) !== undefined);
  const uses = keys.reduce((n, [, c]) => n + c, 0);
  const documentedUses = documented.reduce((n, [, c]) => n + c, 0);
  const pct = (a: number, b: number): string => `${b ? ((100 * a) / b).toFixed(1) : "0"}%`;
  process.stdout.write(`${label}: ${documented.length}/${keys.length} distinct keys documented (${pct(documented.length, keys.length)}), ` +
    `${documentedUses}/${uses} uses (${pct(documentedUses, uses)})\n`);
  if (missing) {
    for (const [k, c] of keys.filter(([k]) => configDoc(k) === undefined).sort((a, b) => b[1] - a[1])) process.stdout.write(`  ${c}\t${k}\n`);
  }
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: { missing: { type: "boolean", default: false } } });
const dir = positionals[0];
if (dir === undefined) throw new Error("usage: coverage.ts <dir of *.pb> [--missing]");
const top: Tally = { keys: new Map() };
const nested: Tally = { keys: new Map() };
const files = readdirSync(dir).filter((f) => f.endsWith(".pb") && f !== "carrier_list.pb");
for (const file of files) for (const cs of settingsIn(dir, file)) walk(cs.configs, top, nested, false);
process.stdout.write(`${files.length} files\n`);
report("top-level keys", top, values.missing);
// Bundle members are mostly data keyed by RAT numbers or MCCMNCs, not config keys; reported apart so they do not dilute the figure.
report("keys inside bundles", nested, values.missing);
