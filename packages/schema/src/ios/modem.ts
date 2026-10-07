/** A bundle's Qualcomm baseband overrides (`*.der.pri`, `*.der.tri`) as ModemConfigs, with the item ids and values Pixel MCFG gets. */

import { hexToBytes } from "@carrier-explode/binary";
import {
	decodedPri,
	decodeFile,
	dialectLabel,
	type OpenedBundle,
	type PriDecoded,
	type TriDecoded,
	type TriField,
} from "@carrier-explode/decode-ios";

import { modemConfigOf } from "../modem/archive.ts";
import { lastPerId, modemValue, qualcommItem } from "../modem/qualcomm/items.ts";
import type { ModemConfig, ModemItem, ModemValue } from "../types.ts";

/** The Intel / Apple C1 key tag: not a Qualcomm EFS path. */
const INTEL_KEY = "9fae72";

/** A CCM group as qualcommItem reads it, labelled `<index>: <note>` per line with what the bundles show of its flags. */
function featureGroup(g: PriDecoded["featureGroups"][number]): ModemItem {
	const notes = g.flags.flatMap((f) => (f.note === undefined ? [] : [`${f.index}: ${f.note}`]));
	return { ...qualcommItem(g.nv, hexToBytes(g.hex)), label: notes.length ? notes.join("\n") : null };
}

/** The NV item list: each item, named where the NV tables know it. */
function nvList(pri: PriDecoded): ModemItem {
	const values = pri.nvListed.map(({ item, name }): ModemValue => ({
		kind: "fields",
		fields: {
			nv: { kind: "number", value: item },
			...(name === undefined ? {} : { name: { kind: "text", value: name } }),
		},
	}));
	const set = pri.nvListed.filter((n) => n.set).map((n) => n.item);
	return {
		id: "pri:nv-list",
		name: "Legacy NV item list",
		description: `Legacy NV items the modem may take from this file; with a value here: ${set.length ? set.join(", ") : "none"}.`,
		value: { kind: "list", values },
		label: null,
		certainty: "high",
	};
}

function schemaIndex(schema: PriDecoded["schema"]): ModemItem {
	return {
		id: "pri:schema",
		name: "NV path schema index",
		description: `${schema.count} NV paths the PRI format knows (${schema.source}); not overrides.`,
		value: { kind: "list", values: schema.paths.map((p): ModemValue => ({ kind: "text", value: p })) },
		label: null,
		certainty: "high",
	};
}

/** A tag no table reads, aggregated: its first value (the decoder keeps 128 bytes of it), how often and how long. */
function unidentified(u: PriDecoded["unknown"][number]): ModemItem {
	const value: ModemValue =
		u.ascii !== undefined
			? { kind: "text", value: u.ascii }
			: u.int !== undefined
				? { kind: "number", value: u.int }
				: { kind: "bytes", hex: u.hex };
	const seen = `Unidentified field, ${u.count} ${u.count === 1 ? "time" : "times"}, ${u.len} bytes`;
	return {
		id: `pri:${u.tag}`,
		name: null,
		description: u.note === undefined ? `${seen}.` : `${seen}: ${u.note}.`,
		value,
		label: null,
		certainty: "opaque",
	};
}

function priItems(pri: PriDecoded): ModemItem[] {
	return [
		...lastPerId([
			...pri.efs.flatMap((e) => (e.tag === INTEL_KEY ? [] : [qualcommItem(e.path, hexToBytes(e.value.hex))])),
			...pri.nv.map((n) => qualcommItem(n.item, hexToBytes(n.value.hex))),
			...pri.featureGroups.map(featureGroup),
		]),
		...pri.named.map((n): ModemItem => ({
			id: `pri:setting/${n.name}`,
			name: n.name,
			description: null,
			value: modemValue(hexToBytes(n.value.hex), true),
			label: null,
			certainty: "high",
		})),
		...(pri.nvListed.length ? [nvList(pri)] : []),
		...(pri.schema.count ? [schemaIndex(pri.schema)] : []),
		...pri.unknown.map(unidentified),
	];
}

function priFacts(pri: PriDecoded): ModemConfig["facts"][number][] {
	const modem = dialectLabel(pri.dialect);
	// Empty header fields ("Carrier ID" on most files) say nothing.
	const header = Object.entries(pri.header)
		.filter(([, value]) => value !== "")
		.map(([label, value]) => ({ label, value }));
	return [...(modem === undefined ? [] : [{ label: "Written for", value: `${modem} modem` }]), ...header];
}

const CERTAINTY = { high: "high", med: "medium", low: "low" } as const satisfies Record<
	NonNullable<TriField["confidence"]>,
	ModemItem["certainty"]
>;

const plmnList = (plmns: readonly string[]): ModemValue => ({
	kind: "list",
	values: plmns.map((p): ModemValue => ({ kind: "text", value: p })),
});

/** A .der.tri record as an item; `tri:<record path>`. Its version is a fact, not an item. */
function triItem(f: Exclude<TriField, { kind: "version" }>): ModemItem {
	const known: Pick<ModemItem, "id" | "name" | "label" | "certainty"> = {
		id: `tri:${f.path}`,
		name: f.name ?? null,
		label: null,
		certainty: f.confidence === undefined ? "opaque" : CERTAINTY[f.confidence],
	};
	switch (f.kind) {
		case "plmn":
			return {
				...known,
				description: "A PLMN; what the modem uses it for is unknown.",
				value: { kind: "text", value: f.plmn },
			};
		case "plmn-list":
			return { ...known, description: null, value: plmnList(f.plmns) };
		case "plmn-act-list":
			return {
				...known,
				description: "PLMNs in priority order, each with the radio access technologies it is selected on.",
				value: {
					kind: "list",
					values: f.entries.map((e): ModemValue => ({
						kind: "fields",
						fields: {
							plmn: { kind: "text", value: e.plmn },
							access: { kind: "text", value: e.access.names.join(", ") },
							...(e.access.unknownBits
								? { unknownBits: { kind: "number", value: e.access.unknownBits } }
								: {}),
						},
					})),
				},
			};
		case "unknown":
			return {
				...known,
				description: `Unidentified record, ${f.hex.length / 2} bytes.`,
				value: { kind: "bytes", hex: f.hex },
			};
	}
}

function triConfig(tri: TriDecoded, path: string, sha: string): ModemConfig {
	const facts = tri.fields.flatMap((f) =>
		f.kind === "version" ? [{ label: f.name ?? "Version", value: f.version }] : [],
	);
	const items = tri.fields.flatMap((f) => (f.kind === "version" ? [] : [triItem(f)]));
	return modemConfigOf({
		family: "qualcomm",
		sha,
		label: path,
		scope: "carrier",
		selection: [],
		facts,
		items,
		base: null,
		combos: [],
		errors: [...tri.errors],
	});
}

const failed = (label: string, sha: string, error: string): ModemConfig =>
	modemConfigOf({
		family: "qualcomm",
		sha,
		label,
		scope: "carrier",
		selection: [],
		facts: [],
		items: [],
		base: null,
		combos: [],
		errors: [error],
	});

/**
 * One override file, labelled by its path; the bundle, not a SIM rule, selects it. Null for an Intel / Apple C1 file
 * (Apple-modem .der.tri included), which has no Qualcomm items; one that does not decode holds only why.
 */
export function iosModemConfig(bundle: OpenedBundle, path: string, sha: string): ModemConfig | null {
	const file = decodeFile(bundle, path);
	if (file.view.type === "tri") return triConfig(file.view.tri, path, sha);
	const pri = decodedPri(file);
	if (pri === undefined)
		return failed(
			path,
			sha,
			`not a DER PRI${file.error?.message === undefined ? "" : `: ${file.error.message}`}`,
		);
	if (pri.dialect === "intel") return null;
	const intel = pri.efs.filter((e) => e.tag === INTEL_KEY).length;
	return modemConfigOf({
		family: "qualcomm",
		sha,
		label: path,
		scope: "carrier",
		selection: [],
		facts: priFacts(pri),
		items: priItems(pri),
		base: null,
		combos: [],
		errors: [...pri.errors, ...(intel ? [`${intel} Intel / Apple C1 keys not shown`] : [])],
	});
}
