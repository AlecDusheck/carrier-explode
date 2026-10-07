/**
 * Shannon Pixels (6–10a): each carrierconfig manifest with its confseqs, the cfg.db SIM matchers that select it,
 * the uecapconfig band-combination files of its carrier, and its items' definitions from the modem firmware.
 */

import * as v from "valibot";

import { u32Hex } from "@carrier-explode/binary";
import { sha1Schema } from "@carrier-explode/schema/records";
import {
	byName,
	confseqPlmnCategories,
	decodeCarrierDb,
	decodeConfseq,
	decodeManifest,
	decodeUeCap,
	ITEM_TYPES,
	itemTable,
	type CarrierDb,
	type ItemDef,
	type Plmn,
	type SimMatcher,
} from "@carrier-explode/decode-shannon";
import type { Filesystem } from "@carrier-explode/firmware";
import {
	gunzipped,
	jsonBytes,
	listed,
	ModemExtractError,
	readInOrder,
	uniqueLabels,
	type ExtractedModem,
	type ModemArchive,
} from "./archive.ts";

const CARRIERCONFIG = "firmware/carrierconfig";
const UECAPCONFIG = "firmware/uecapconfig";
const UECAP_NAME = /\.binarypb$/;

/** The firmware's name in the build directory: some images gzip it. */
export const MODEM_BINS: ReadonlySet<string> = new Set(["modem.bin", "modem.bin.gz"]);

/** ap_plmn_mapping.binarypb: carrier index -> PLMNs, and the combination files per index, by name. */
interface UeCap {
	readonly plmns: ReadonlyMap<number, readonly Plmn[]>;
	readonly names: ReadonlyMap<number, readonly string[]>;
}

type PlmnMap = Map<number, readonly Plmn[]>;

const addPlmns = (map: PlmnMap, index: number, plmns: readonly Plmn[]): PlmnMap =>
	map.set(index, [...(map.get(index) ?? []), ...plmns]);

/** The regular files of `dir` named by hex SHA-1s that `wanted` keeps, by name. */
async function sha1Files(
	fs: Filesystem,
	dir: string,
	wanted: (sha: string) => boolean,
): Promise<Map<string, Uint8Array>> {
	const entries = await listed(fs, dir);
	if (!entries) throw new ModemExtractError(`vendor/${dir}: missing`);
	return readInOrder(
		fs,
		dir,
		entries.filter((e) => e.kind === "file" && v.is(sha1Schema, e.name) && wanted(e.name)),
	);
}

/** Each file decoded once for its carrier index and let go, as together they outgrow a step: they are read again per carrier when stored. */
async function ueCap(fs: Filesystem): Promise<UeCap> {
	const plmns: PlmnMap = new Map();
	const names = new Map<number, string[]>();
	const entries = ((await listed(fs, UECAPCONFIG)) ?? [])
		.filter((e) => e.kind === "file" && UECAP_NAME.test(e.name))
		.toSorted((a, b) => a.inode - b.inode);
	for (const { name } of entries) {
		const file = decodeUeCap(await fs.readFile(`${UECAPCONFIG}/${name}`));
		if (file.kind === "plmn-map") for (const c of file.carriers) addPlmns(plmns, c.index, c.plmns);
		// lte-ca files name no carrier index: they are not any one carrier's.
		else if (file.kind === "combinations")
			names.set(file.carrierIndex, [...(names.get(file.carrierIndex) ?? []), name]);
	}
	return { plmns, names: new Map([...names].map(([i, n]) => [i, n.toSorted()])) };
}

/** The combination files one carrier's configs share, read for the set asked last: configs are stored grouped by set. */
function ueCapReader(fs: Filesystem): (names: readonly string[]) => Promise<ReadonlyMap<string, Uint8Array>> {
	let held: { readonly key: string; readonly files: Promise<ReadonlyMap<string, Uint8Array>> } | undefined;
	return (names) => {
		const key = names.join("/");
		if (held?.key !== key)
			held = {
				key,
				files: (async () =>
					new Map(
						await Promise.all(names.map(async (n) => [n, await fs.readFile(`${UECAPCONFIG}/${n}`)] as const)),
					))(),
			};
		return held.files;
	};
}

/** "310-90" and "310-090": uecapconfig writes some three-digit MNCs with two digits, so PLMNs compare as numbers. */
const plmnKey = (mcc: string, mnc: string): string => `${Number(mcc)}-${Number(mnc)}`;

/** The carrier indexes whose PLMNs a config's SIMs use; failing any, those covering its MCCs with any MNC. */
export function ueCapIndexes(
	matchers: readonly SimMatcher[],
	plmns: ReadonlyMap<number, readonly Plmn[]>,
): number[] {
	const exact = new Set(matchers.map((m) => plmnKey(m.mccMnc.slice(0, 3), m.mccMnc.slice(3))));
	const mccs = new Set(matchers.map((m) => Number(m.mccMnc.slice(0, 3))));
	const hits = (test: (p: Plmn) => boolean): number[] =>
		[...plmns]
			.filter(([, ps]) => ps.some(test))
			.map(([i]) => i)
			.toSorted((a, b) => a - b);
	const byPlmn = hits((p) => p.mnc !== null && exact.has(plmnKey(p.mcc, p.mnc)));
	return byPlmn.length ? byPlmn : hits((p) => p.mnc === null && mccs.has(Number(p.mcc)));
}

/** Opens the firmware as a stream once per pass of itemTable's two: it outgrows a step, so each pass reads the partition again. */
async function modemBin(modem: Filesystem, dir: string): Promise<() => AsyncIterable<Uint8Array>> {
	const names = new Set((await listed(modem, dir))?.map((e) => e.name));
	if (names.has("modem.bin")) return () => modem.readStream(`${dir}/modem.bin`);
	if (names.has("modem.bin.gz")) return () => gunzipped(modem.readStream(`${dir}/modem.bin.gz`));
	throw new ModemExtractError(`modem/${dir}: no modem.bin(.gz)`);
}

/** The firmware's item definitions, by item hash. */
export type ShannonItems = ReadonlyMap<number, ItemDef>;

/** ShannonItems as JSON: [hash, definition] pairs. */
export const shannonItemsSchema = v.pipe(
	v.array(
		v.tuple([v.number(), v.object({ name: v.string(), type: v.picklist(ITEM_TYPES), capacity: v.number() })]),
	),
	v.transform((pairs): ShannonItems => new Map(pairs)),
);

/** The item table of the firmware in images/<label>/, streamed twice. */
export async function shannonItems(modem: Filesystem, label: string): Promise<ShannonItems> {
	return itemTable(await modemBin(modem, `images/${label}`));
}

/** The configurations on the vendor partition of the firmware `label`; the item table is read last, and only its configs' items kept. */
export async function shannonModem(
	vendor: Filesystem,
	label: string,
	itemTableOf: () => Promise<ShannonItems>,
): Promise<ExtractedModem> {
	const db: CarrierDb = decodeCarrierDb(await vendor.readFile(`${CARRIERCONFIG}/cfg.db`));
	const manifests = [...(await sha1Files(vendor, `${CARRIERCONFIG}/manifests`, () => true))]
		.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([sha, bytes]) => ({ sha, bytes, manifest: decodeManifest(bytes) }));
	const used = new Set(
		manifests.flatMap(({ manifest }) =>
			manifest.entries.flatMap((e) => (e.scope === "file" ? [] : [e.confseq])),
		),
	);
	const confseqs = new Map(
		[...(await sha1Files(vendor, `${CARRIERCONFIG}/confseqs`, (sha) => used.has(sha)))].map(
			([sha, bytes]) => [sha, { bytes, items: decodeConfseq(bytes).items }] as const,
		),
	);
	const uecap = await ueCap(vendor);
	const hashes = new Set([...confseqs.values()].flatMap((c) => c.items.map((it) => it.hash)));
	const defs = new Map([...(await itemTableOf())].filter(([hash]) => hashes.has(hash)));

	const readUeCap = ueCapReader(vendor);
	const archives = manifests.map(({ sha, bytes, manifest }) => {
		const plmns: PlmnMap = new Map(uecap.plmns);
		const seqs = manifest.entries.flatMap((e) => {
			if (e.scope === "file") return [];
			const confseq = confseqs.get(e.confseq);
			if (!confseq) throw new ModemExtractError(`${sha}: confseq ${e.confseq} not read`);
			return [{ name: e.confseq, ...confseq }];
		});
		// Builds without ap_plmn_mapping.binarypb map carrier indexes in a plmn_mapping confseq.
		for (const { items } of seqs) {
			for (const c of confseqPlmnCategories(byName(new Map(items.map((it) => [it.hash, it.values])))))
				addPlmns(plmns, c.index, c.plmns);
		}
		const matchers = db.carriers.filter((c) => c.config?.manifest === sha).flatMap((c) => c.matchers);
		const combos = [
			...new Set(ueCapIndexes(matchers, plmns).flatMap((i) => uecap.names.get(i) ?? [])),
		].toSorted();
		const archive: ModemArchive = {
			label: manifest.name,
			path: `vendor/${CARRIERCONFIG}/manifests/${sha}`,
			files: async () => {
				const files = new Map<string, Uint8Array>([
					["manifest.pb", bytes],
					...seqs.map((q) => [`confseqs/${q.name}.pb`, q.bytes] as const),
				]);
				// An item the registry lacks still reaches the config, untyped: normalization reports it.
				const defined = new Map(
					seqs.flatMap((q) =>
						q.items.flatMap((it) => {
							const def = defs.get(it.hash);
							return def === undefined ? [] : [[it.hash, def] as const];
						}),
					),
				);
				files.set(
					"items.json",
					jsonBytes(
						Object.fromEntries(
							[...defined].toSorted(([a], [b]) => a - b).map(([h, def]) => [u32Hex(h), def]),
						),
					),
				);
				files.set("carrier.json", jsonBytes(matchers));
				for (const [name, b] of await readUeCap(combos)) files.set(`uecap/${name}`, b);
				return files;
			},
		};
		return { archive, combos: combos.join("/") };
	});
	// Grouped by combination files, so each carrier's are read once.
	const grouped = archives
		.toSorted((a, b) => (a.combos < b.combos ? -1 : a.combos > b.combos ? 1 : 0))
		.map((a) => a.archive);
	return { family: "shannon", firmware: label, archives: uniqueLabels(grouped) };
}
