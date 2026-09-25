/**
 * Apple C1 modem package (Firmware/c4000v59/Release/patched/ftab.bin): an
 * 'rkos' 'ftab' container of tagged entries. Only the entry table and the
 * build string are read here; tools/ftab/ftab.py goes further.
 *
 *   0x20 'rkos' 'ftab', 0x28 u32 count, 0x30 count × { tag[4], u32 offset, u32 size, u32 0 }
 */

import { asciiAt, latin1, u32le } from "./bytes";
import { MODEM_SUMMARY_SCHEMA, modemFamily } from "./modem";

export interface FtabEntry { tag: string; offset: number; size: number }

export interface FtabBuild {
  /** "240.3431000025000000.5941" */
  build?: string;
  /** BBFW:3.01.03 */
  version?: string;
  /** date:2026 8 13, as 2026-08-13 */
  date?: string;
  /** "c4000v59" */
  chip?: string;
  /** chip_revision_b0 */
  chipRevision?: string;
}

export interface FtabSummary {
  schema: typeof MODEM_SUMMARY_SCHEMA;
  kind: "ftab";
  package: FtabBuild & { name?: string; family?: string; bver?: string };
  entries: FtabEntry[];
}

export function parseFtab(b: Uint8Array): FtabEntry[] {
  if (b.length < 0x30 || !asciiAt(b, 0x20, "rkosftab")) throw new Error("not an rkos/ftab container");
  const n = u32le(b, 0x28);
  if (0x30 + 16 * n > b.length) throw new Error(`ftab entry table (${n}) runs past the file`);
  const out: FtabEntry[] = [];
  for (let i = 0, p = 0x30; i < n; i++, p += 16) {
    const e = { tag: latin1(b.subarray(p, p + 4)).replace(/\0+$/, ""), offset: u32le(b, p + 4), size: u32le(b, p + 8) };
    if (e.offset + e.size > b.length) throw new Error(`ftab entry ${e.tag} runs past the file`);
    out.push(e);
  }
  return out;
}

/** "240.…|24.0.0.0|BBFW:3.01.03|date:2026 8 13|c4000v59|chip_revision_b0" */
export function parseBver(s: string): FtabBuild {
  const out: FtabBuild = {};
  const parts = s.trim().split("|");
  if (/^[\d.]+$/.test(parts[0] ?? "")) out.build = parts[0];
  for (const p of parts) {
    const m = /^BBFW:(.+)$/.exec(p);
    if (m) out.version = m[1];
    const d = /^date:(\d{4}) (\d{1,2}) (\d{1,2})$/.exec(p);
    if (d) out.date = `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
    if (/^c\d{4}\w*$/.test(p)) out.chip = p;
    const r = /^chip_revision_(\w+)$/.exec(p);
    if (r) out.chipRevision = r[1];
  }
  return out;
}

export function ftabSummary(b: Uint8Array, opts: { name?: string } = {}): FtabSummary {
  const entries = parseFtab(b);
  const bver = entries.find((e) => e.tag === "bver");
  const text = bver ? latin1(b.subarray(bver.offset, bver.offset + bver.size)).replace(/\0+$/, "").trim() : undefined;
  const name = opts.name;
  const family = name && modemFamily(name);
  return {
    schema: MODEM_SUMMARY_SCHEMA,
    kind: "ftab",
    package: {
      ...(name ? { name } : {}),
      ...(family ? { family } : {}),
      ...(text ? { bver: text, ...parseBver(text) } : {}),
    },
    entries,
  };
}
