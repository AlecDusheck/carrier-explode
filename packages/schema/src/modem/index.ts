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
	readonly isNr: ((item: Pick<ModemItem, "id" | "name">) => boolean) | null;
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

/** A draft with its combinations keyed, named by `sha`, or by its content's for a base, which is no artifact's. */
async function finish(
	draft: Omit<ConfigDraft, "sha">,
	base: string | null,
	sha: string | null,
): Promise<{ config: ModemConfig; lists: KeyedLists }> {
	const { sets, lists } = await keyCombos(draft.combos);
	const content = { ...draft, base, combos: sets };
	const named = sha ?? (await sha256Hex(new TextEncoder().encode(JSON.stringify(content))));
	return { config: modemConfigOf({ ...content, sha: named }), lists };
}

export async function modemConfig(bytes: Uint8Array, sha: string): Promise<NormalizedModem> {
	const files = unpackFiles(bytes);
	const [family, ...more] = Object.values(FAMILIES).filter((f) => files.has(f.marker));
	if (family === undefined || more.length > 0)
		throw new Error(`modem-config ${sha}: not one family's archive (${[...files.keys()].join(", ")})`);
	return normalizeMapped(family.map(files, sha));
}

/** A mapper's config, its base and their combinations keyed. */
export async function normalizeMapped(mapped: MappedConfig): Promise<NormalizedModem> {
	const base = mapped.base === null ? null : await finish(mapped.base, null, null);
	const own = await finish(mapped.config, base?.config.sha ?? null, mapped.config.sha);
	return {
		config: own.config,
		base: base?.config ?? null,
		combos: new Map([...own.lists, ...(base?.lists ?? [])]),
	};
}

/** "unread": the family names too few items (MediaTek: its SBP items alone) for its configurations to say. */
export const CONFIG_RADIOS = ["nr", "lte", "unread"] as const;
export type ConfigRadio = (typeof CONFIG_RADIOS)[number];

export function configRadio(config: {
	readonly family: ModemConfig["family"];
	readonly items: ReadonlyArray<Pick<ModemItem, "id" | "name">>;
}): ConfigRadio {
	const isNr = FAMILIES[config.family].isNr;
	return isNr === null ? "unread" : config.items.some(isNr) ? "nr" : "lte";
}
