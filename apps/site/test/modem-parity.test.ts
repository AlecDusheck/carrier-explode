/**
 * ModemConfigView shows everything the old PRI view showed: rendered on the server from each Qualcomm .der.pri in
 * decode-ios's AT&T and Verizon fixtures, its HTML holds every field decodePri gives, where the view puts it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import { decodedPri, decodeFile, dialectLabel, openIpcc, type PriValue } from "@carrier-explode/decode-ios";
import { iosModemConfig } from "@carrier-explode/schema";
import ModemConfigView from "../src/lib/components/modem/ModemConfigView.svelte";

const FIXTURES = join(import.meta.dirname, "../../../packages/decode-ios/test/fixtures");
const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const literal = (s: string): string => s.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");

/** What the old PriValueCell wrote for a value before any click: the number, the quoted string, a chip's size. */
function shown(v: PriValue): string {
  switch (v.kind) {
    case "int": return `>${v.int}`;
    case "string": return `"${escape(v.text)}"`;
    case "xml": return `show XML, ${v.len} bytes`;
    case "bytes": return `hex, ${v.len} bytes`;
    case "empty": return "empty";
  }
}

describe("ModemConfigView renders what PriView rendered", () => {
  const files = ["carrier-att.ipcc", "carrier-verizon.ipcc"].flatMap((name) => {
    const b = openIpcc(new Uint8Array(readFileSync(join(FIXTURES, name))));
    return b.info.files.filter((f) => f.path.endsWith(".der.pri")).map((f) => ({ b, path: `${name}/${f.path}`, file: f.path }));
  });

  it.each(files)("$path", ({ b, file }) => {
    const pri = decodedPri(decodeFile(b, file));
    const config = iosModemConfig(b, file, "sha");
    if (pri === undefined || pri.dialect === "intel") return expect(config).toBeNull();
    if (config === null) throw new Error("no config");
    const { body } = render(ModemConfigView, { props: { config } });
    const has = (s: string): void => expect(body).toContain(s);
    // A line's key carries its component's style scope.
    const key = (name: string): void => expect(body).toMatch(new RegExp(`class="key [^"]*">${literal(escape(name))}</span>`));

    // Header and error banners.
    for (const e of pri.errors) has(escape(e));
    const fact = (k: string, v: string): void => has(`${escape(k)}</td><td${v.includes(" ") ? "" : ' class="mono"'}>${escape(v)}</td>`);
    fact("Written for", `${dialectLabel(pri.dialect)} modem`);
    for (const [k, v] of Object.entries(pri.header)) if (v) fact(k, v);
    // Every override and NV value: name, meaning line, path or item, value and its label.
    for (const e of [...pri.efs.map((x) => ({ ...x, id: `efs:${x.path}` })), ...pri.nv.map((x) => ({ ...x, id: `nv:${x.item}` }))]) {
      has(escape(e.id));
      if (e.name) key(e.name);
      if (e.meaning && e.meaning !== e.name) has(`<span class="note">${escape(e.meaning)}`);
      has(shown(e.value));
      if (e.label) has(escape(e.label));
    }
    // Feature groups: name, NV, count set, a grid cell per flag, the note under each set flag.
    for (const g of pri.featureGroups) {
      key(g.name);
      has(`nv:${g.nv}`);
      has(`${g.bits.length} of ${g.total} flags set`);
      for (const f of g.flags) expect(body).toMatch(new RegExp(`class="flag[^"]*${f.set ? " set" : ""}[^"]*" title="flag ${f.index} = ${f.value}`));
      for (const f of g.flags.filter((x) => x.set && x.note)) has(`<b>${f.index}</b>: ${escape(f.note ?? "")}`);
    }
    for (const n of pri.named) has(escape(n.name));
    // The NV item list, the schema index and unidentified tags, behind their chips.
    if (pri.nvListed.length) has(`show list, ${pri.nvListed.length} entries`);
    if (pri.schema.count) has(`show list, ${pri.schema.count} entries`);
    for (const u of pri.unknown) has(`pri:${u.tag}`);
  });
});
