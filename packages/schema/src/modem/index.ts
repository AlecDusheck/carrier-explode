/** An `android.modem-config` artifact -> ModemConfig, by the family its archive's members name. */

import { sha256Hex, unpackFiles } from "@carrier-explode/binary";

import type { BandCombination, ModemConfig, ModemVendor, ModemItem } from "../types.ts";
import { modemConfigOf, type ArchiveFiles, type ConfigDraft, type MappedConfig } from "./archive.ts";
import { keyCombos } from "./combos.ts";
import { MEDIATEK_OP_OTA, mediatekConfig } from "./mediatek/index.ts";
import { isNrItem as qualcommNr, QUALCOMM_IMAGE, qualcommConfig } from "./qualcomm/index.ts";
import { isNrItem as shannonNr, SHANNON_MANIFEST, shannonConfig } from "./shannon/index.ts";

interface Family {
  readonly marker: string;
  readonly map: (files: ArchiveFiles, sha: string) => MappedConfig;
  /** Whether an item configures 5G; null for a family that names too few items to tell. */
  readonly isNr: ((item: ModemItem) => boolean) | null;
}

/** The member that marks each family's archive, its mapper, and how its items show 5G. */
const FAMILIES = {
  qualcomm: { marker: QUALCOMM_IMAGE, map: qualcommConfig, isNr: qualcommNr },
  shannon: { marker: SHANNON_MANIFEST, map: shannonConfig, isNr: shannonNr },
  mediatek: { marker: MEDIATEK_OP_OTA, map: mediatekConfig, isNr: null },
} as const satisfies Record<ModemVendor, Family>;

/** What normalizing one archive stores: its config, the base it is built on, and every combination list either names. */
export interface NormalizedModem {
  readonly config: ModemConfig;
  readonly base: ModemConfig | null;
  readonly combos: ReadonlyMap<string, readonly BandCombination[]>;
}

type KeyedLists = ReadonlyMap<string, readonly BandCombination[]>;

async function finish(draft: ConfigDraft, base: string | null): Promise<{ config: ModemConfig; lists: KeyedLists }> {
  const { sets, lists } = await keyCombos(draft.combos);
  return { config: modemConfigOf({ ...draft, base, combos: sets }), lists };
}

/** The base's sha is its content's: every config on the same layers names the same one. */
async function finishBase(draft: Omit<ConfigDraft, "sha">): Promise<{ config: ModemConfig; lists: KeyedLists }> {
  const { sets, lists } = await keyCombos(draft.combos);
  const content = { ...draft, base: null, combos: sets };
  const sha = await sha256Hex(new TextEncoder().encode(JSON.stringify(content)));
  return { config: modemConfigOf({ ...content, sha }), lists };
}

export async function modemConfig(bytes: Uint8Array, sha: string): Promise<NormalizedModem> {
  const files = unpackFiles(bytes);
  const [family, ...more] = Object.values(FAMILIES).filter((f) => files.has(f.marker));
  if (family === undefined || more.length > 0) throw new Error(`modem-config ${sha}: not one family's archive (${[...files.keys()].join(", ")})`);
  return normalizeMapped(family.map(files, sha));
}

/** A mapper's config, its base and their combinations keyed. */
export async function normalizeMapped(mapped: MappedConfig): Promise<NormalizedModem> {
  const base = mapped.base === null ? null : await finishBase(mapped.base);
  const own = await finish(mapped.config, base?.config.sha ?? null);
  return { config: own.config, base: base?.config ?? null, combos: new Map([...own.lists, ...(base?.lists ?? [])]) };
}

/** "unread": the family names too few items (MediaTek: its SBP items alone) for its configurations to say. */
export type ConfigRadio = "nr" | "lte" | "unread";

export function configRadio(config: Pick<ModemConfig, "family" | "items">): ConfigRadio {
  const isNr = FAMILIES[config.family].isNr;
  return isNr === null ? "unread" : config.items.some(isNr) ? "nr" : "lte";
}
