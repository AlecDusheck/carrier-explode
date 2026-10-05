/**
 * Pixel modem configurations for the v2 fixture bucket: one archive per family, packed as the extractor
 * packs `android.modem-config` artifacts from the decoders' own fixtures. The Qualcomm one is DoCoMo's, selected
 * by its own records (44010); Shannon and MediaTek are selected by T-Mobile's 310260.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, packFiles, sha1Hex } from "@carrier-explode/binary";
import { pairSelection, parseMcfg, parseSelectionDb } from "@carrier-explode/decode-qualcomm";
import type { ModemVendor } from "@carrier-explode/schema/types";

const PACKAGES = join(import.meta.dirname, "../../../../../packages");
const fixture = (pkg: string, name: string): Uint8Array => new Uint8Array(readFileSync(join(PACKAGES, pkg, "test/fixtures", name)));
const json = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));

/** Protobuf bytes from (field, value) pairs: numbers as varints, everything else length-delimited. */
function pb(fields: ReadonlyArray<readonly [number, number | string | Uint8Array]>): Uint8Array {
  const varint = (n: number): number[] => {
    const out: number[] = [];
    for (; n > 0x7f; n = Math.floor(n / 128)) out.push((n & 0x7f) | 0x80);
    return [...out, n];
  };
  return new Uint8Array(fields.flatMap(([f, x]) => {
    if (typeof x === "number") return [...varint(f * 8), ...varint(x)];
    const b = typeof x === "string" ? new TextEncoder().encode(x) : x;
    return [...varint(f * 8 + 2), ...varint(b.length), ...b];
  }));
}
const hexBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

/** The Pixel 5a's DCM MCFG (Commercial-DCM), the selection records the cut selection db pairs with it, and a few combos. */
function qualcomm(): Map<string, Uint8Array> {
  const mbn = fixture("decode-qualcomm", "pixel5a/dcm-cut.mbn");
  const image = parseMcfg(mbn);
  if (image === undefined) throw new Error("dcm-cut.mbn: not MCFG");
  const db = parseSelectionDb(new TextDecoder().decode(fixture("decode-qualcomm", "pixel5a/mcfg_sel_db-cut.xml")));
  const selection = pairSelection([{ image }], db).paired.flatMap((p) => p.records);
  const combos = "<CARRIER_LIST><PLMN-ID>440-10</PLMN-ID><DCM>b1A[4]-n78A[2,2]A;b1A-b19A-b42C;n78C[4]-b3A</DCM></CARRIER_LIST>";
  return new Map([
    ["mcfg_sw.mbn", mbn],
    ["selection.json", json(selection)],
    ["band_combos_per_plmn.xml", new TextEncoder().encode(combos)],
  ]);
}

/** decode-shannon's confseqs under a two-layer manifest, a cfg.db row for 310260, and its uecap combinations; `wildcard`, which no row names, on the same base. */
function shannon(name: "us_tmo" | "wildcard"): Map<string, Uint8Array> {
  const plain = fixture("decode-shannon", "confseq-plain.pb");
  const ca = fixture("decode-shannon", "confseq-clz4.bin");
  const entry = (scope: number, seq: Uint8Array, base: boolean): Uint8Array =>
    pb([...(scope === 0 ? [] : [[1, scope] as const]), [2, hexBytes(sha1Hex(seq))], ...(base ? [[4, 1] as const] : []), [8, 4]]);
  const MTU = "!NRPM.MTU_DEFAULT_SIZE";
  const row = { mccMnc: "310260", imsiPrefix: null, spn: null, gid1: null, gid2: null, iccidPrefix: null, accessRule: null, plmnName: "T-Mobile", preferredApn: null };
  return new Map([
    ["manifest.pb", pb([[1, "v0.1"], [2, name], ...(name === "wildcard" ? [] : [[3, 4242] as const]), [5, entry(0, ca, true)], [5, entry(1, plain, false)]])],
    [`confseqs/${sha1Hex(plain)}.pb`, plain],
    [`confseqs/${sha1Hex(ca)}.pb`, ca],
    ["names.json", json({ [crc32(new TextEncoder().encode(MTU)).toString(16).padStart(8, "0")]: [MTU] })],
    ["carrier.json", json(name === "wildcard" ? [] : [row, { ...row, gid1: "6D" }])],
    ["uecap/TMO_1.binarypb", fixture("decode-shannon", "uecap-combinations.pb")],
    ["uecap/lte_1.binarypb", fixture("decode-shannon", "uecap-lte.pb")],
    ["uecap/ap_plmn_mapping.binarypb", fixture("decode-shannon", "uecap-plmn.pb")],
  ]);
}

/** The fixtures' items as a900a-MP_260716's md1rom item table shapes them: LID, size, unit, array depth. */
const MEDIATEK_SHAPES = {
  build: "a900a-MP_260716-260716-M-15880348",
  items: {
    7916: [1346, 1, "byte", 0], 7989: [1346, 1, "byte", 0], 8398: [2191, 1, "byte", 2], 8399: [2191, 1, "byte", 1],
    8400: [2191, 8, "bit", 1], 8401: [2191, 1, "byte", 1], 8402: [2191, 4, "byte", 1], 8403: [2191, 32, "bit", 1],
    8405: [2191, 1, "byte", 1], 8406: [2191, 8, "bit", 1], 8407: [2191, 1, "byte", 1], 8408: [2191, 8, "bit", 1],
    8409: [2191, 1, "bit", 1], 11082: [2191, 1, "byte", 1], 11083: [2191, 8, "bit", 1], 17960: [2191, 1, "bit", 1],
    28976: [961, 8, "bit", 0], 29084: [960, 1, "bit", 0], 29086: [960, 1, "bit", 0], 29087: [960, 1, "bit", 0],
    29088: [960, 1, "bit", 0], 29089: [960, 1, "bit", 0], 29090: [960, 1, "bit", 0], 35279: [960, 1, "bit", 0],
  },
  owners: { 960: "SBP", 961: "SBP", 1346: "IMS", 2191: "D2" },
};

/** decode-mediatek's OP-OTA and NW-OTA as SBP 8's; its OP-OTA alone as SBP 0, no operator's. */
function mediatek(sbp: 0 | 8): Map<string, Uint8Array> {
  return new Map([
    ["op.mcfopota", fixture("decode-mediatek", "op-ota.mcfopota")],
    ...(sbp === 8 ? [["nw.mcfnwota", fixture("decode-mediatek", "nw-ota.mcfnwota")] as const] : []),
    ["sbp.json", json(sbp === 8 ? { id: 8, operator: "T-Mobile", plmns: [{ mcc: "310", mnc: "260" }] } : { id: 0, operator: null, plmns: [] })],
    ["items.json", json(MEDIATEK_SHAPES)],
  ]);
}

export interface ModemFixture {
  readonly family: ModemVendor;
  readonly firmware: string;
  readonly devices: readonly string[];
  readonly archives: readonly Uint8Array[];
}

/** Per family, the Pixels of the fixture's newest build that carry it. */
export const MODEM_FIXTURES: readonly ModemFixture[] = [
  { family: "qualcomm", firmware: "MCFG-g7250-00271-260601", devices: ["redfin"], archives: [packFiles(qualcomm())] },
  { family: "shannon", firmware: "g5400c-260604-260804-B-14012345", devices: ["tokay", "caiman", "frankel"], archives: [packFiles(shannon("us_tmo")), packFiles(shannon("wildcard"))] },
  { family: "mediatek", firmware: "a900a-260605-260807-B-14078422", devices: ["cubs"], archives: [packFiles(mediatek(8)), packFiles(mediatek(0))] },
];
