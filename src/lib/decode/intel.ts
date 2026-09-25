/**
 * Intel-dialect (Intel modem, kept by Apple C1) `.der.pri` / `.der.gri` settings:
 * `%u:dyn_cps.apf.sat.plmn[0].mcc`-style keys turned into a tree of groups,
 * record tables and lists, with band bitmaps, PLMNs and band-combo strings decoded.
 */
// Key grammar: `%u:` uint, `%qu[N]:` N-byte "label:value" string, `%s[N]:` N-byte string, then a dotted path (corpus: KDDI D23/V59/V159, ATT D321, Default global_setting B/G/L).

import type { NvConfidence } from "./nv";
import type { PriValue } from "./pri";
import { parseCombo, type ComboComponent } from "./policy";

/* ------------------------------------------------------------------- keys */

export type IntelType = "u" | "qu" | "s";

export interface IntelSeg { name: string; idx: number[] }

export interface IntelKey {
  type: IntelType;
  /** Declared byte size of a `%qu[N]` / `%s[N]` string. */
  size?: number;
  /** Dotted path without the type prefix. */
  path: string;
  segs: IntelSeg[];
}

/** Parse `%qu[8]:dyn_cps_gri.lte_regulatory_info.na_table[0][0]`; null if the key is not Intel-shaped. */
export function parseIntelKey(key: string): IntelKey | null {
  const m = /^%(u|qu|s)(?:\[(\d+)\])?:(.+)$/.exec(key.trim());
  if (!m) return null;
  const segs: IntelSeg[] = [];
  for (const part of m[3].trim().split(".")) {
    const s = /^([A-Za-z_][\w]*)((?:\[\d+\])*)$/.exec(part);
    if (!s) return null;
    segs.push({ name: s[1], idx: [...s[2].matchAll(/\d+/g)].map((x) => Number(x[0])) });
  }
  return { type: m[1] as IntelType, ...(m[2] ? { size: Number(m[2]) } : {}), path: m[3].trim(), segs };
}

/** Fixed-size arrays are zero-filled past their last entry; one trailing zero can be a real value, a run of them is padding. */
function usedSlots(items: Array<{ value: { raw: string } }>): number {
  let n = items.length;
  while (n > 0 && items[n - 1].value.raw === "0") n--;
  return items.length - n >= 2 ? n : items.length;
}

/** GRI regulatory tables are split by region; the key names them by these prefixes (Default.bundle global_setting B/G/L). */
export const INTEL_REGIONS: Record<string, string> = {
  na: "North America", la: "Latin America", eu: "Europe", africa: "Africa", asia: "Asia", ocean: "Oceania", ww: "Worldwide",
};

/* ----------------------------------------------------------------- values */

export interface IntelCombo {
  /** As written, e.g. `1A_18A_n3A`. */
  combo: string;
  /** The part after `/`: a sub-combination of `combo`. */
  fallback?: string;
  components: ComboComponent[];
  fallbackComponents?: ComboComponent[];
  /** Every fallback carrier is in the combo at the same or a lower bandwidth class. */
  subset?: boolean;
}

export type IntelDecoded =
  | { kind: "bands"; rat: "lte" | "nr"; bands: number[]; confidence: NvConfidence }
  | { kind: "bits"; bits: number[]; note: string; confidence: NvConfidence }
  | { kind: "band"; rat: "lte" | "nr"; band: number; confidence: NvConfidence }
  | { kind: "combos"; combos: IntelCombo[]; confidence: NvConfidence }
  | { kind: "mccBands"; mcc: string; rat: "nr"; bands: number[]; confidence: NvConfidence };

export interface IntelValue {
  /** The value as stored (decimal for integers). */
  raw: string;
  int?: number;
  /** `%qu` values are `label:value`; this is the label. */
  label?: string;
  /** The value after the label (equals `raw` when there is none). */
  text: string;
  decoded?: IntelDecoded;
}

const bitsOf = (n: number, offset = 0): number[] => {
  const out: number[] = [];
  for (let b = 0; b < 32; b++) if (Math.floor(n / 2 ** b) % 2) out.push(offset + b);
  return out;
};

const intOf = (s: string): number | undefined => {
  const t = s.trim();
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16);
  return /^\d+$/.test(t) ? Number(t) : undefined;
};

// `lte_band_mask_33_64`, `bitmap_bands_1_32`, `disable_bitmap_bands_33_64`, `ice_mcc_mimo_bitmask_65_96`: bit k = band first+k.
// Verified: global_setting_G na_table mcc 302 decodes to Canada's LTE bands 2 4 5 7 12 13 14 17 25 29 30 38 41 46 53 66 71.
const RANGE = /(band_mask|bitmap_bands|bitmask)_(\d+)_(\d+)$/;
// `lte_disallowed_nc_ca_band_bitmap[w]`: word w bit k = band 32w+k+1; KDDI D23 words {5, 768} = bands 1 3 41 42, the same four as its lte_ca_dl_disallowed_list.
const LTE_WORDS = /lte\w*band_bitmap$/;
// `allowed_(n)sa_band_bitmap[w]`: KDDI D23 sets bits 2 14 21 / 36; as band numbers that is n3 n15 n22 n37, not KDDI's bands, so the bits index a modem band table.
const NR_WORDS = /allowed_n?sa_band_bitmap$/;
const COMBO_TOKEN = /^n?\d+[A-Z]+$/;

function ratOf(name: string, path: string): "lte" | "nr" | undefined {
  if (/^lte_|_lte_|errc|lte_caps/.test(name) || /\blte|errc|eutra/.test(path)) return "lte";
  if (/^nr_|_nr_|5g|uwb/.test(name) || /5g|nrrc|\.nr_|uwb/.test(path)) return "nr";
  return undefined;
}

/** `1A_18A_n3A/1A_n3A#…`: `#` ends an entry, `/` splits a combo from a fallback of it. */ // KDDI D23 bc_white_list: every `/` right side is a sub-combination of its left
export function parseComboList(s: string): IntelCombo[] | null {
  const entries = s.split("#").map((x) => x.trim()).filter(Boolean);
  if (!entries.length) return null;
  const out: IntelCombo[] = [];
  for (const e of entries) {
    const [combo, fallback, extra] = e.split("/");
    if (extra !== undefined) return null;
    const parts = [combo, fallback].filter((x): x is string => x !== undefined);
    if (!parts.every((p) => p.split("_").every((t) => COMBO_TOKEN.test(t)))) return null;
    // Same grammar as band_combos_per_plmn.xml once `_` becomes `-` and LTE bands take a `b`.
    const comps = (p: string) => parseCombo(p.split("_").map((t) => (t.startsWith("n") ? t : "b" + t)).join("-")).components;
    const c: IntelCombo = { combo, components: comps(combo) };
    if (fallback !== undefined) {
      c.fallback = fallback;
      c.fallbackComponents = comps(fallback);
      c.subset = isSubset(c.fallbackComponents, c.components);
    }
    out.push(c);
  }
  return out;
}

function isSubset(sub: ComboComponent[], of: ComboComponent[]): boolean {
  const pool = [...of];
  for (const x of sub) {
    const i = pool.findIndex((y) => y.rat === x.rat && y.band === x.band && y.dl[0] >= x.dl[0]);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

/** Decode one leaf value from its field name and path. */
export function intelValue(key: IntelKey, name: string, raw: string, int?: number): IntelValue {
  const v: IntelValue = { raw, text: raw, ...(int !== undefined ? { int } : {}) };
  const lv = /^([A-Za-z_][\w]*):(.*)$/.exec(raw);
  if (key.type === "qu" && lv) {
    v.label = lv[1];
    v.text = lv[2];
    const n = intOf(lv[2]);
    if (n !== undefined) v.int = n;
  }
  const field = v.label ?? name;
  const r = RANGE.exec(field);
  if (r && v.int !== undefined) {
    const rat = ratOf(field, key.path) === "nr" ? "nr" : "lte";
    v.decoded = { kind: "bands", rat, bands: bitsOf(v.int, Number(r[2])), confidence: /band_mask/.test(field) ? "high" : "med" };
    return v;
  }
  // GRI NR regulatory rows: `302:2-5-7-12-…` = MCC 302, NR bands n2 n5 n7 n12 …
  const mb = /^(\d{3}):(\d+(?:-\d+)*)$/.exec(raw);
  if (mb) {
    v.label = mb[1];
    v.text = mb[2];
    v.decoded = { kind: "mccBands", mcc: mb[1], rat: "nr", bands: mb[2].split("-").map(Number), confidence: "high" };
    return v;
  }
  if (key.type === "s" && /[#/]/.test(raw)) {
    const combos = parseComboList(raw);
    if (combos) v.decoded = { kind: "combos", combos, confidence: "med" };
    return v;
  }
  if (v.int && /(^|_)band(_num)?$/.test(field)) {
    const rat = /^lte_/.test(field) ? "lte" : /^nr_/.test(field) ? "nr" : ratOf(field, key.path);
    if (rat) v.decoded = { kind: "band", rat, band: v.int, confidence: "med" };
  }
  return v;
}

/* ------------------------------------------------------------------ tree */

export interface IntelNote { text: string; confidence: NvConfidence }

export interface IntelLeaf { kind: "leaf"; name: string; path: string; key: string; value: IntelValue }

export interface IntelListItem { index: number[]; key: string; value: IntelValue }

export interface IntelList {
  kind: "list";
  name: string;
  path: string;
  items: IntelListItem[];
  /** Items before a run of trailing zeros: the slots of a fixed-size array that are in use. */
  used: number;
  /** The whole list read as one value (a multi-word band bitmap). */
  decoded?: IntelDecoded;
}

export type IntelCell = IntelValue | IntelTable | IntelList;

export interface IntelRow {
  index: number[];
  cells: Record<string, IntelCell>;
  /** `MCC-MNC` from the row's mcc / mnc fields. */
  plmn?: string;
  /** The row's mcc on its own, decoded the same way. */
  mcc?: string;
}

export type PlmnEncoding = "decimal" | "bcd" | "packed";

export interface IntelTable {
  kind: "table";
  name: string;
  path: string;
  columns: string[];
  rows: IntelRow[];
  /** How mcc / mnc are stored in this table. */
  plmnEncoding?: PlmnEncoding;
}

export interface IntelGroup {
  kind: "group";
  /** One or more path segments; single-child chains are folded into one group. */
  name: string;
  path: string;
  note?: IntelNote;
  children: IntelNode[];
}

export type IntelNode = IntelGroup | IntelLeaf | IntelList | IntelTable;

export const isIntelNode = (c: IntelCell): c is IntelTable | IntelList => "kind" in c;

export interface IntelRegMcc {
  /** Region table the row came from: na, eu, asia, africa, la, ocean, ww. */
  region: string;
  mcc: string;
  lte: number[];
  nrSa?: number[];
  nrNsa?: number[];
}

export interface IntelRegPlmn {
  /** lte_band_per_plmn or lte_regulatory_table_per_plmn. */
  table: string;
  plmn: string;
  lte: number[];
}

export interface IntelTree {
  nodes: IntelNode[];
  /** Settings read. */
  count: number;
  /** Keys that did not parse; kept flat. */
  unparsed: IntelLeaf[];
  /** GRI: allowed bands per country code and per PLMN. */
  regulatory?: { mcc: IntelRegMcc[]; plmn: IntelRegPlmn[] };
}

// Name-derived notes for top-level groups; matched against the path after the dyn_cps* root.
const NOTES: Array<[RegExp, string]> = [
  [/^apf\.sat$|^sat$/, "Satellite (NTN): whether it is enabled and which PLMNs it may use."],
  [/^apf\.rat_icon$/, "Status-bar RAT icon: when 5G and 5G UW show, hysteresis timers, UW bands and bandwidths."],
  [/^apf\.sdm$/, "Smart Data Mode: dynamic RAT selection, falling back from 5G when it is not needed."],
  [/^apf\.ue_capability_enhancement\.bc_filters$/, "Band-combination filters applied to the UE capability report."],
  [/^op_features\.hplmn_band_restriction$/, "NR bands allowed on the home network, NSA and SA."],
  [/^errc\.plmn_band_restriction_info$/, "LTE bands disabled on listed PLMNs."],
  [/^errc$/, "LTE RRC (E-UTRA radio resource control)."],
  [/^nrrc$/, "NR RRC (radio resource control)."],
  [/^as_5g_params\.hplmn_based_filter_params$/, "NR filters on the home PLMN: bandwidths per band and whitelisted band combinations."],
  [/^as_5g_(params|caps)$/, "NR access stratum: radio parameters and capabilities."],
  [/^lte_regulatory_info$/, "LTE bands allowed per country code, one table per region."],
  [/^nr_n?sa_regulatory_info$/, "NR bands allowed per country code (SA or NSA), one table per region."],
  [/^plmn_band_pri_list$/, "Band search priority per operator group, with EARFCN ranges."],
  [/^geran_disabled_mcc_list$/, "Country codes where GSM is disabled."],
];

function noteFor(path: string): IntelNote | undefined {
  const rel = path.split(".").slice(1).join(".");
  const hit = NOTES.find(([re]) => re.test(rel));
  return hit ? { text: hit[1], confidence: "med" } : undefined;
}

type Raw = { t: "obj"; m: Map<string, Raw> } | { t: "arr"; m: Map<number, Raw> } | { t: "leaf"; key: IntelKey; full: string; name: string; value: IntelValue };

const obj = (): Raw => ({ t: "obj", m: new Map() });

export interface IntelEntry { key: string; value: PriValue | string }

/** Build the tree from key / value pairs in file order. */
export function intelTree(entries: IntelEntry[]): IntelTree {
  const root = obj();
  const unparsed: IntelLeaf[] = [];
  let count = 0;
  for (const e of entries) {
    const k = parseIntelKey(e.key);
    const pv = typeof e.value === "string" ? undefined : e.value;
    const raw = typeof e.value === "string" ? e.value : e.value.kind === "empty" ? "" : e.value.text;
    const int = pv?.kind === "int" && pv.exact === undefined ? pv.int : undefined;
    count++;
    if (!k) {
      unparsed.push({ kind: "leaf", name: e.key, path: e.key, key: e.key, value: { raw, text: raw, ...(int !== undefined ? { int } : {}) } });
      continue;
    }
    const last = k.segs[k.segs.length - 1].name;
    const leaf: Raw = { t: "leaf", key: k, full: e.key, name: last, value: intelValue(k, last, raw, int) };
    let cur = root;
    k.segs.forEach((s, si) => {
      const steps: Array<string | number> = [s.name, ...s.idx];
      steps.forEach((step, i) => {
        const end = si === k.segs.length - 1 && i === steps.length - 1;
        const nextIsIdx = i < steps.length - 1;
        const m = cur.t === "obj" || cur.t === "arr" ? (cur.m as Map<string | number, Raw>) : undefined;
        if (!m) return;
        let n = m.get(step);
        if (end) { m.set(step, leaf); return; }
        if (!n || n.t === "leaf") { n = nextIsIdx ? { t: "arr", m: new Map() } : obj(); m.set(step, n); }
        cur = n;
      });
    });
  }
  const nodes = [...(root as { m: Map<string, Raw> }).m].map(([k, v]) => toNode(k, k, v));
  const tree: IntelTree = { nodes: nodes.map(fold), count, unparsed };
  const reg = regulatory(entries);
  if (reg) tree.regulatory = reg;
  return tree;
}

function toNode(name: string, path: string, r: Raw): IntelNode {
  if (r.t === "leaf") return { kind: "leaf", name, path, key: r.full, value: r.value };
  if (r.t === "arr") return arrNode(name, path, r);
  const children = mergeRanges([...r.m].map(([k, v]) => toNode(k, path + "." + k, v)), path);
  return { kind: "group", name, path, ...withNote(path), children };
}

const withNote = (path: string) => { const n = noteFor(path); return n ? { note: n } : {}; };

/** Flatten nested array levels to (index path, element). */
function flatArr(r: Raw, idx: number[] = []): Array<[number[], Raw]> {
  if (r.t !== "arr") return [[idx, r]];
  return [...r.m].sort((a, b) => a[0] - b[0]).flatMap(([i, v]) => flatArr(v, [...idx, i]));
}

function arrNode(name: string, path: string, r: Raw): IntelList | IntelTable {
  const els = flatArr(r);
  const leaves = els.filter(([, v]) => v.t === "leaf") as Array<[number[], Extract<Raw, { t: "leaf" }>]>;
  // `na_table[i][j] = label:value`: row i, column label.
  if (leaves.length === els.length && els.every(([i]) => i.length === 2) && leaves.every(([, v]) => v.value.label && v.value.decoded?.kind !== "mccBands")) {
    const rows = new Map<number, IntelRow>();
    for (const [[i], v] of leaves) {
      const row = rows.get(i) ?? { index: [i], cells: {} };
      row.cells[v.value.label!] = v.value;
      rows.set(i, row);
    }
    return table(name, path, [...rows.values()].map((row) => ({ ...row, cells: mergeCells(row.cells) })));
  }
  if (leaves.length === els.length) {
    const items = leaves.map(([index, v]) => ({ index, key: v.full, value: v.value }));
    const list: IntelList = { kind: "list", name, path, items, used: usedSlots(items) };
    const d = wordBitmap(name, path, list.items);
    if (d) list.decoded = d;
    return list;
  }
  // Array of records: one row per element, nested arrays stay nodes inside the cell.
  const rows: IntelRow[] = els.map(([index, v]) => {
    const cells: Record<string, IntelCell> = {};
    const walk = (x: Raw, prefix: string, p: string) => {
      if (x.t === "leaf") { cells[prefix || "value"] = x.value; return; }
      for (const [k, c] of x.m as Map<string | number, Raw>) {
        const col = prefix ? prefix + "." + k : String(k);
        if (c.t === "arr") cells[col] = arrNode(String(k), p + "." + k, c);
        else walk(c, col, p + "." + k);
      }
    };
    walk(v, "", path + index.map((i) => `[${i}]`).join(""));
    return { index, cells: mergeCells(cells) };
  });
  return table(name, path, rows);
}

function table(name: string, path: string, rows: IntelRow[]): IntelTable {
  const columns: string[] = [];
  for (const r of rows) for (const c of Object.keys(r.cells)) if (!columns.includes(c)) columns.push(c);
  const t: IntelTable = { kind: "table", name, path, columns, rows };
  if (columns.includes("mcc")) plmns(t);
  return t;
}

function wordBitmap(name: string, path: string, items: IntelListItem[]): IntelDecoded | undefined {
  if (!items.every((x) => x.index.length === 1 && x.value.int !== undefined)) return undefined;
  const words = items.flatMap((x) => bitsOf(x.value.int!, 32 * x.index[0]));
  if (LTE_WORDS.test(name)) return { kind: "bands", rat: "lte", bands: words.map((b) => b + 1), confidence: "high" };
  if (NR_WORDS.test(name) || (/band_bitmap$/.test(name) && ratOf(name, path) === "nr"))
    return { kind: "bits", bits: words, note: "Bit positions; they index a modem NR band table, not band numbers.", confidence: "low" };
  return undefined;
}

/* ---------------------------------------------------------- band ranges */

const rangeKey = (name: string) => RANGE.exec(name);

/** Fold `x_1_32`, `x_33_64`, … into one `x` value whose bands are the union. */
function mergeCells(cells: Record<string, IntelCell>): Record<string, IntelCell> {
  const baseOf = (k: string, c: IntelCell) => {
    const m = !isIntelNode(c) && c.decoded?.kind === "bands" ? rangeKey(k) : null;
    return m ? k.slice(0, m.index + m[1].length) : undefined;
  };
  const groups = new Map<string, Array<[string, IntelValue]>>();
  for (const [k, c] of Object.entries(cells)) {
    const b = baseOf(k, c);
    if (b) groups.set(b, [...(groups.get(b) ?? []), [k, c as IntelValue]]);
  }
  const out: Record<string, IntelCell> = {};
  for (const [k, c] of Object.entries(cells)) {
    const b = baseOf(k, c);
    const parts = b ? groups.get(b)! : [];
    if (parts.length > 1) { if (parts[0][0] === k) out[b!] = mergeValues(parts); }
    else out[k] = c;
  }
  return out;
}

function mergeValues(parts: Array<[string, IntelValue]>): IntelValue {
  const bands = parts.flatMap(([, v]) => (v.decoded?.kind === "bands" ? v.decoded.bands : []));
  const first = parts[0][1].decoded as Extract<IntelDecoded, { kind: "bands" }>;
  // Zero words say nothing; the flat key list keeps every one.
  const shown = parts.filter(([, v]) => v.int !== 0);
  const raw = (shown.length ? shown : parts.slice(0, 1)).map(([k, v]) => `${rangeKey(k)![2]}_${rangeKey(k)![3]}=${v.text}`).join(" ");
  return { raw, text: raw, decoded: { kind: "bands", rat: first.rat, bands: bands.sort((a, b) => a - b), confidence: first.confidence } };
}

function mergeRanges(children: IntelNode[], path: string): IntelNode[] {
  const cells: Record<string, IntelCell> = {};
  const keys = new Map<string, string>();
  for (const c of children) if (c.kind === "leaf") { cells[c.name] = c.value; keys.set(c.name, c.key); }
  const merged = mergeCells(cells);
  const out: IntelNode[] = [];
  const done = new Set<string>();
  for (const c of children) {
    if (c.kind !== "leaf") { out.push(c); continue; }
    if (merged[c.name]) { out.push(c); continue; }
    const m = rangeKey(c.name)!;
    const base = c.name.slice(0, m.index + m[1].length);
    if (done.has(base)) continue;
    done.add(base);
    out.push({ kind: "leaf", name: base, path: path + "." + base, key: c.key, value: merged[base] as IntelValue });
  }
  return out;
}

/* --------------------------------------------------------------- PLMNs */

const pad = (s: string, n: number) => s.padStart(n, "0");

// Three encodings in the corpus: decimal (apf.sat 440/55), BCD-as-hex (errc plmn_band_restriction 0x440/0x54 = 440-54),
// and 3GPP TS 24.008 packed PLMN bytes (ecsr_whitelist plmn 0x36f1/0x40 = 631-04, under mcc 0x631).
function plmnEncoding(mccs: number[]): PlmnEncoding {
  if (mccs.every((m) => m <= 999)) return "decimal";
  // Packed PLMNs carry a filler F nibble or overflow three BCD digits (ecsr plmn 0x06f2 = 602).
  return mccs.some((m) => m > 0xfff || /[a-f]/.test(m.toString(16))) ? "packed" : "bcd";
}

function decodeMcc(n: number, enc: PlmnEncoding): string | undefined {
  if (enc === "decimal") return pad(String(n), 3);
  if (enc === "bcd") { const h = n.toString(16); return /^\d{1,3}$/.test(h) ? pad(h, 3) : undefined; }
  const d = [(n >> 8) & 15, (n >> 12) & 15, n & 15];
  return d.every((x) => x <= 9) ? d.join("") : undefined;
}

function decodeMnc(n: number, mcc: number, enc: PlmnEncoding): string | undefined {
  if (enc === "decimal") return n > 999 ? undefined : n >= 100 ? String(n) : pad(String(n), 2);
  if (enc === "bcd") { const h = n.toString(16); return /^\d{1,3}$/.test(h) ? (h.length === 3 ? h : pad(h, 2)) : undefined; }
  const m3 = (mcc >> 4) & 15, m1 = n & 15, m2 = (n >> 4) & 15;
  if (m1 > 9 || m2 > 9 || (m3 > 9 && m3 !== 15)) return undefined;
  return `${m1}${m2}${m3 === 15 ? "" : m3}`;
}

function plmns(t: IntelTable) {
  const num = (c: IntelCell | undefined) => (c && !isIntelNode(c) ? c.int : undefined);
  const mccs = t.rows.map((r) => num(r.cells.mcc)).filter((x): x is number => x !== undefined);
  if (!mccs.length) return;
  // Packed PLMNs sit under a BCD mcc column in ecsr_whitelist; only the table's own values decide.
  const enc = plmnEncoding(mccs);
  t.plmnEncoding = enc;
  for (const r of t.rows) {
    const mcc = num(r.cells.mcc), mnc = num(r.cells.mnc);
    if (mcc === undefined) continue;
    const c = decodeMcc(mcc, enc);
    if (!c) continue;
    r.mcc = c;
    const n = mnc !== undefined ? decodeMnc(mnc, mcc, enc) : undefined;
    if (n) r.plmn = `${c}-${n}`;
  }
}

/* -------------------------------------------------------------- folding */

/** Fold a group whose only child is a group into it: `apf` › `rat_icon` › `nas_config` reads as one. */
function fold(n: IntelNode): IntelNode {
  if (n.kind !== "group") return n;
  let g = n;
  let note = g.note;
  while (g.children.length === 1 && g.children[0].kind === "group") {
    const c = g.children[0] as IntelGroup;
    note = c.note ?? note;
    g = { ...c, name: g.name + "." + c.name };
  }
  return { kind: "group", name: g.name, path: g.path, ...(note ? { note } : {}), children: g.children.map(fold) };
}

/* --------------------------------------------------------- regulatory */

function regulatory(entries: IntelEntry[]): IntelTree["regulatory"] | undefined {
  const lte = new Map<string, Map<number, { mcc?: string; mnc?: string; bands: number[] }>>();
  const nr = { sa: new Map<string, number[]>(), nsa: new Map<string, number[]>() };
  const nrRegion = new Map<string, string>();
  for (const e of entries) {
    const k = parseIntelKey(e.key);
    if (!k) continue;
    const raw = typeof e.value === "string" ? e.value : e.value.text;
    const m = /(?:^|\.)(?:lte_regulatory_info\.(\w+)_table|(lte_band_per_plmn|lte_regulatory_table_per_plmn))\[(\d+)\]\[\d+\]$/.exec(k.path);
    if (m) {
      const table = m[1] ?? m[2];
      const rows = lte.get(table) ?? new Map();
      lte.set(table, rows);
      const row = rows.get(Number(m[3])) ?? { bands: [] };
      rows.set(Number(m[3]), row);
      const v = intelValue(k, "", raw);
      if (v.label === "mcc") row.mcc = v.text;
      else if (v.label === "mnc") row.mnc = v.text;
      else if (v.decoded?.kind === "bands") row.bands.push(...v.decoded.bands);
      continue;
    }
    const n = /(?:^|\.)nr_(sa|nsa)_regulatory_info\.(\w+)_table\[\d+\]$/.exec(k.path);
    const mb = n && /^(\d{3}):(\d+(?:-\d+)*)$/.exec(raw);
    if (n && mb) {
      nr[n[1] as "sa" | "nsa"].set(mb[1], mb[2].split("-").map(Number));
      if (!nrRegion.has(mb[1])) nrRegion.set(mb[1], n[2]);
    }
  }
  if (!lte.size && !nr.sa.size && !nr.nsa.size) return undefined;
  const byMcc: IntelRegMcc[] = [];
  const plmn: IntelRegPlmn[] = [];
  const sort = (b: number[]) => [...new Set(b)].sort((x, y) => x - y);
  for (const [table, rows] of lte) {
    for (const r of rows.values()) {
      if (!r.mcc) continue;
      if (r.mnc !== undefined) { plmn.push({ table, plmn: `${pad(r.mcc, 3)}-${pad(r.mnc, 2)}`, lte: sort(r.bands) }); continue; }
      byMcc.push({ region: table, mcc: r.mcc, lte: sort(r.bands) });
    }
  }
  const seen = new Set(byMcc.map((r) => r.mcc));
  for (const mcc of new Set([...nr.sa.keys(), ...nr.nsa.keys()])) if (!seen.has(mcc)) byMcc.push({ region: nrRegion.get(mcc) ?? "", mcc, lte: [] });
  for (const r of byMcc) {
    const sa = nr.sa.get(r.mcc), nsa = nr.nsa.get(r.mcc);
    if (sa) r.nrSa = sa;
    if (nsa) r.nrNsa = nsa;
  }
  return { mcc: byMcc, plmn };
}

/* --------------------------------------------------------------- filter */

const valueText = (v: IntelValue): string => {
  const d = v.decoded;
  const extra = !d ? "" : d.kind === "bands" || d.kind === "mccBands" ? d.bands.map((b) => (d.rat === "nr" ? "n" : "b") + b).join(" ")
    : d.kind === "band" ? (d.rat === "nr" ? "n" : "b") + d.band : d.kind === "combos" ? "" : d.bits.join(" ");
  return `${v.raw} ${v.label ?? ""} ${extra}`.toLowerCase();
};

/** Keep the nodes, rows and items that mention `f` (lower case) in a name, path or value. */
export function filterIntel(nodes: IntelNode[], f: string): IntelNode[] {
  if (!f) return nodes;
  const out: IntelNode[] = [];
  for (const n of nodes) {
    if (n.path.toLowerCase().includes(f)) { out.push(n); continue; }
    if (n.kind === "leaf") { if (valueText(n.value).includes(f)) out.push(n); continue; }
    if (n.kind === "list") {
      const items = n.items.filter((x) => valueText(x.value).includes(f));
      if (items.length) out.push({ ...n, items });
      continue;
    }
    if (n.kind === "table") {
      const rows = n.rows.filter((r) => (r.plmn ?? r.mcc ?? "").includes(f) || Object.entries(r.cells).some(([k, c]) =>
        k.toLowerCase().includes(f) || (isIntelNode(c) ? filterIntel([c], f).length > 0 : valueText(c).includes(f))));
      if (rows.length) out.push({ ...n, rows });
      continue;
    }
    const children = filterIntel(n.children, f);
    if (children.length) out.push({ ...n, children });
  }
  return out;
}
