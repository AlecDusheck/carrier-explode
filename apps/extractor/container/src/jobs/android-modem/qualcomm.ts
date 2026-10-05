/**
 * Qualcomm Pixels (1–5a): each SW MCFG with the selection records that pick it, from the HW configs' selection
 * database, and their per-PLMN band combos when they carry them.
 */

import {
  mcfgItemData, pairSelection, parseMcfg, parseSelectionDb, SELECTION_DB_PATH, trailerField, type McfgImage, type SelectionRecord,
} from "@carrier-explode/decode-qualcomm";
import type { Filesystem } from "@carrier-explode/firmware";
import { findFiles, jsonBytes, listed, ModemExtractError, readIfPresent, uniqueLabels, type ExtractedModem, type ModemArchive, type ModemImages } from "./archive.ts";

/** NON-HLOS's build id, `SSD:<label>`: at the root on the Pixel 1, under image/ from the Pixel 2. */
const VERSION_FILES = ["image/version.cfg", "version.cfg"] as const;
const VERSION = /^SSD:(\S+)\s*$/;
const BAND_COMBOS_PATH = "/policyman/band_combos_per_plmn.xml";

/** Where mcfg_sw/ and mcfg_hw/ live: the Pixel 1's modem FAT, Pixel 3–5a and Pixel 2 vendor. */
const CONFIG_ROOTS = [
  { partition: "modem", dir: "modem_pr/mcfg/configs" },
  { partition: "vendor", dir: "rfs/msm/mpss/readonly/vendor/mbn" },
  { partition: "vendor", dir: "mbn/mcfg/configs" },
] as const;

interface SwConfig {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly image: McfgImage;
  readonly label: string;
}

async function firmware(modem: Filesystem): Promise<string> {
  for (const path of VERSION_FILES) {
    const bytes = await readIfPresent(modem, path);
    if (!bytes) continue;
    const text = new TextDecoder().decode(bytes);
    const m = VERSION.exec(text);
    if (!m?.[1]) throw new ModemExtractError(`modem/${path}: ${JSON.stringify(text.slice(0, 80))} is not SSD:<label>`);
    return m[1];
  }
  throw new ModemExtractError(`modem: none of ${VERSION_FILES.join(", ")}`);
}

/** The first root holding mcfg_sw/, with its filesystem. */
async function configRoot(images: ModemImages): Promise<{ readonly fs: Filesystem; readonly partition: string; readonly dir: string }> {
  for (const { partition, dir } of CONFIG_ROOTS) {
    const fs = partition === "modem" ? images.modem : await images.vendor();
    if (await listed(fs, `${dir}/mcfg_sw`)) return { fs, partition, dir };
  }
  throw new ModemExtractError(`no mcfg_sw directory in ${CONFIG_ROOTS.map((r) => `${r.partition}/${r.dir}`).join(", ")}`);
}

async function swConfig(fs: Filesystem, path: string): Promise<SwConfig> {
  const bytes = await fs.readFile(path);
  const image = parseMcfg(bytes);
  if (!image) throw new ModemExtractError(`${path} is not an MCFG image`);
  const label = trailerField(image.trailer, "label")?.text;
  if (label === undefined) throw new ModemExtractError(`${path} has no trailer label`);
  return { path, bytes, image, label };
}

interface HwConfig {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly image: McfgImage;
}

async function hwConfig(fs: Filesystem, path: string): Promise<HwConfig> {
  const bytes = await fs.readFile(path);
  const image = parseMcfg(bytes);
  if (!image) throw new ModemExtractError(`${path} is not an MCFG image`);
  return { path, bytes, image };
}

/** An EFS file the HW configs carry, as text; the configs that carry it must agree. */
function hwFile(hw: readonly HwConfig[], efsPath: string): string | undefined {
  const texts = new Map<string, string>();
  for (const { path, bytes, image } of hw) {
    const item = image.items.find((it) => it.kind === "file" && it.path === efsPath);
    if (item) texts.set(new TextDecoder().decode(mcfgItemData(bytes, item)), path);
  }
  const [only, ...more] = texts;
  if (more.length) throw new ModemExtractError(`${efsPath} differs: ${[...texts.values()].join(", ")}`);
  return only?.[0];
}

export async function qualcommModem(images: ModemImages): Promise<ExtractedModem> {
  const { fs, partition, dir } = await configRoot(images);
  const sw: SwConfig[] = [];
  for (const path of await findFiles(fs, `${dir}/mcfg_sw`, "mcfg_sw.mbn")) sw.push(await swConfig(fs, path));
  const hw: HwConfig[] = [];
  if (await listed(fs, `${dir}/mcfg_hw`)) for (const path of await findFiles(fs, `${dir}/mcfg_hw`, "mcfg_hw.mbn")) hw.push(await hwConfig(fs, path));
  const dbXml = hwFile(hw, SELECTION_DB_PATH);
  const records = new Map<SwConfig, readonly SelectionRecord[]>(
    dbXml === undefined ? [] : pairSelection(sw, parseSelectionDb(dbXml)).paired.map((p) => [p.config, p.records]),
  );
  const bandCombos = hwFile(hw, BAND_COMBOS_PATH);
  const archives = sw.map((c): ModemArchive => {
    const files = new Map([["mcfg_sw.mbn", c.bytes], ["selection.json", jsonBytes(records.get(c) ?? [])]]);
    if (bandCombos !== undefined) files.set("band_combos_per_plmn.xml", new TextEncoder().encode(bandCombos));
    return { label: c.label, path: `${partition}/${c.path}`, files };
  });
  return { family: "qualcomm", firmware: await firmware(images.modem), archives: uniqueLabels(archives) };
}
