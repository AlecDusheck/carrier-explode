/**
 * Shannon Pixels (6–10a): each carrierconfig manifest with its confseqs, the cfg.db SIM matchers that select it,
 * the uecapconfig band-combination files of its carrier, and its items' definitions from the modem firmware.
 */

import { gunzipSync } from "node:zlib";
import * as v from "valibot";

import { u32Hex } from "@carrier-explode/binary";
import { sha1Schema } from "@carrier-explode/schema/records";
import {
  byName, confseqPlmnCategories, decodeCarrierDb, decodeConfseq, decodeManifest, decodeUeCap, itemTable,
  type CarrierDb, type ItemDef, type Plmn, type SimMatcher,
} from "@carrier-explode/decode-shannon";
import type { Filesystem } from "@carrier-explode/firmware";
import { jsonBytes, listed, ModemExtractError, readIfPresent, tensorLabel, uniqueLabels, type ExtractedModem, type ModemArchive, type ModemImages } from "./archive.ts";

const CARRIERCONFIG = "firmware/carrierconfig";
const UECAPCONFIG = "firmware/uecapconfig";
const UECAP_NAME = /\.binarypb$/;

/** The firmware's name in the build directory: some images gzip it. */
export const MODEM_BINS: ReadonlySet<string> = new Set(["modem.bin", "modem.bin.gz"]);

/** A combination file of one carrier index. */
interface UeCapFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** ap_plmn_mapping.binarypb: carrier index -> PLMNs, and the combination files per index. */
interface UeCap {
  readonly plmns: ReadonlyMap<number, readonly Plmn[]>;
  readonly files: ReadonlyMap<number, readonly UeCapFile[]>;
}

type PlmnMap = Map<number, readonly Plmn[]>;

const addPlmns = (map: PlmnMap, index: number, plmns: readonly Plmn[]): PlmnMap => map.set(index, [...(map.get(index) ?? []), ...plmns]);

/** Regular files whose names are hex SHA-1s, sorted. */
async function sha1Files(fs: Filesystem, dir: string): Promise<string[]> {
  const entries = await listed(fs, dir);
  if (!entries) throw new ModemExtractError(`vendor/${dir}: missing`);
  return entries.filter((e) => e.kind === "file" && v.is(sha1Schema, e.name)).map((e) => e.name).sort();
}

async function ueCap(fs: Filesystem): Promise<UeCap> {
  const plmns: PlmnMap = new Map();
  const files = new Map<number, UeCapFile[]>();
  const names = ((await listed(fs, UECAPCONFIG)) ?? []).filter((e) => e.kind === "file" && UECAP_NAME.test(e.name)).map((e) => e.name).sort();
  for (const name of names) {
    const bytes = await fs.readFile(`${UECAPCONFIG}/${name}`);
    const file = decodeUeCap(bytes);
    if (file.kind === "plmn-map") for (const c of file.carriers) addPlmns(plmns, c.index, c.plmns);
    // lte-ca files name no carrier index: they are not any one carrier's.
    else if (file.kind === "combinations") files.set(file.carrierIndex, [...(files.get(file.carrierIndex) ?? []), { name, bytes }]);
  }
  return { plmns, files };
}

/** "310-90" and "310-090": uecapconfig writes some three-digit MNCs with two digits, so PLMNs compare as numbers. */
const plmnKey = (mcc: string, mnc: string): string => `${Number(mcc)}-${Number(mnc)}`;

/** The carrier indexes whose PLMNs a config's SIMs use; failing any, those covering its MCCs with any MNC. */
export function ueCapIndexes(matchers: readonly SimMatcher[], plmns: ReadonlyMap<number, readonly Plmn[]>): number[] {
  const exact = new Set(matchers.map((m) => plmnKey(m.mccMnc.slice(0, 3), m.mccMnc.slice(3))));
  const mccs = new Set(matchers.map((m) => Number(m.mccMnc.slice(0, 3))));
  const hits = (test: (p: Plmn) => boolean): number[] => [...plmns].filter(([, ps]) => ps.some(test)).map(([i]) => i).sort((a, b) => a - b);
  const byPlmn = hits((p) => p.mnc !== null && exact.has(plmnKey(p.mcc, p.mnc)));
  return byPlmn.length ? byPlmn : hits((p) => p.mnc === null && mccs.has(Number(p.mcc)));
}

async function modemBin(modem: Filesystem, dir: string): Promise<Uint8Array> {
  return (await readIfPresent(modem, `${dir}/modem.bin`)) ?? gunzipSync(await modem.readFile(`${dir}/modem.bin.gz`));
}

export async function shannonModem(images: ModemImages): Promise<ExtractedModem> {
  const vendor = await images.vendor();
  const db: CarrierDb = decodeCarrierDb(await vendor.readFile(`${CARRIERCONFIG}/cfg.db`));
  const manifests = await Promise.all((await sha1Files(vendor, `${CARRIERCONFIG}/manifests`)).map(async (sha) => {
    const bytes = await vendor.readFile(`${CARRIERCONFIG}/manifests/${sha}`);
    return { sha, bytes, manifest: decodeManifest(bytes) };
  }));
  const confseqs = new Map<string, { readonly bytes: Uint8Array; readonly items: ReturnType<typeof decodeConfseq>["items"] }>();
  for (const { manifest } of manifests) {
    for (const e of manifest.entries) {
      if (e.scope === "file" || confseqs.has(e.confseq)) continue;
      const bytes = await vendor.readFile(`${CARRIERCONFIG}/confseqs/${e.confseq}`);
      confseqs.set(e.confseq, { bytes, items: decodeConfseq(bytes).items });
    }
  }
  const uecap = await ueCap(vendor);

  const label = await tensorLabel(images.modem);
  const defs = itemTable(await modemBin(images.modem, `images/${label}`));

  const archives = manifests.map(({ sha, bytes, manifest }): ModemArchive => {
    const files = new Map<string, Uint8Array>([["manifest.pb", bytes]]);
    const plmns: PlmnMap = new Map(uecap.plmns);
    const used = new Map<number, ItemDef>();
    for (const e of manifest.entries) {
      if (e.scope === "file") continue;
      const confseq = confseqs.get(e.confseq);
      if (!confseq) throw new ModemExtractError(`${sha}: confseq ${e.confseq} not read`);
      files.set(`confseqs/${e.confseq}.pb`, confseq.bytes);
      // An item the registry lacks still reaches the config, untyped: normalization reports it.
      for (const it of confseq.items) {
        const def = defs.get(it.hash);
        if (def) used.set(it.hash, def);
      }
      // Builds without ap_plmn_mapping.binarypb map carrier indexes in a plmn_mapping confseq.
      const values = new Map(confseq.items.map((it) => [it.hash, it.values]));
      for (const c of confseqPlmnCategories(byName(values))) addPlmns(plmns, c.index, c.plmns);
    }
    files.set("items.json", jsonBytes(Object.fromEntries([...used].sort(([a], [b]) => a - b).map(([h, def]) => [u32Hex(h), def]))));
    const matchers = db.carriers.filter((c) => c.config?.manifest === sha).flatMap((c) => c.matchers);
    files.set("carrier.json", jsonBytes(matchers));
    for (const index of ueCapIndexes(matchers, plmns)) {
      for (const f of uecap.files.get(index) ?? []) files.set(`uecap/${f.name}`, f.bytes);
    }
    return { label: manifest.name, path: `vendor/${CARRIERCONFIG}/manifests/${sha}`, files };
  });
  return { family: "shannon", firmware: label, archives: uniqueLabels(archives) };
}
