/**
 * Qualcomm policyman XML: a lenient, DOM-free tree parser that tags each node with its role in a rule, plus the
 * band_combos_per_plmn.xml and A-MPR NS tables.
 */

import { decodeXmlEntities, XML_ATTR } from "@carrier-explode/binary";
import type { Building } from "./building.ts";

/** Role of a node in a policyman rule. */
type PolicyKind =
	| "policy" // <policy>, <policy_list>
	| "branch" // if / then / else / select / case
	| "logic" // any_of / all_of / not
	| "condition" // a test under if, case or a logic node
	| "action" // a statement under then, else, actions or policy
	| "define" // a declaration under initial
	| "comment"
	| "data"; // everything else: list members, plain config XML

export interface PolicyNode {
	readonly tag: string;
	readonly kind: PolicyKind;
	readonly attrs: Record<string, string>;
	/** Trimmed text content, when there is any. */
	readonly text?: string;
	readonly children: PolicyNode[];
}

// Element roles from the policyman grammar census (bbcfg.mbn + qdsp6sw.mbn + iOS 27.0 .der.pri XML)
const LOGIC = new Set(["any_of", "all_of", "not"]);
const BRANCH = new Set(["if", "then", "else", "select", "case"]);
const TEST_PARENTS = new Set(["if", "case", "any_of", "all_of", "not"]);
const ACTION_PARENTS = new Set(["then", "else", "actions", "policy"]);

function kindOf(tag: string, parent?: PolicyNode): PolicyKind {
	if (tag === "policy" || tag === "policy_list") return "policy";
	if (LOGIC.has(tag)) return "logic";
	if (BRANCH.has(tag) || tag === "actions" || tag === "initial") return "branch";
	if (!parent) return "data";
	if (TEST_PARENTS.has(parent.tag)) return "condition";
	if (parent.tag === "initial" || parent.kind === "define") return "define";
	if (ACTION_PARENTS.has(parent.tag)) return "action";
	return "data";
}

/** A node list (normally one root), tolerating what firmware files do: trailing NULs, unclosed or stray end tags, bare `&`. */
export function parsePolicyXml(xml: string): PolicyNode[] {
	const root: Building<PolicyNode> = { tag: "#root", kind: "data", attrs: {}, children: [] };
	const stack: Building<PolicyNode>[] = [root];
	// Close tags never pop the root, so the stack is never empty.
	const top = (): Building<PolicyNode> => stack.at(-1) ?? root;
	const addText = (s: string) => {
		const t = decodeXmlEntities(s).trim();
		if (!t) return;
		const n = top();
		n.text = n.text ? `${n.text} ${t}` : t;
	};
	let i = 0;
	while (i < xml.length) {
		const lt = xml.indexOf("<", i);
		if (lt < 0) {
			addText(xml.slice(i).replace(/\0+$/, ""));
			break;
		}
		if (lt > i) addText(xml.slice(i, lt));
		if (xml.startsWith("<!--", lt)) {
			const end = xml.indexOf("-->", lt + 4);
			const body = xml.slice(lt + 4, end < 0 ? xml.length : end).trim();
			top().children.push({ tag: "#comment", kind: "comment", attrs: {}, text: body, children: [] });
			i = end < 0 ? xml.length : end + 3;
			continue;
		}
		if (xml.startsWith("<![CDATA[", lt)) {
			const end = xml.indexOf("]]>", lt + 9);
			const body = xml.slice(lt + 9, end < 0 ? xml.length : end).trim();
			if (body) {
				const n = top();
				n.text = n.text ? `${n.text} ${body}` : body;
			}
			i = end < 0 ? xml.length : end + 3;
			continue;
		}
		const gt = xml.indexOf(">", lt + 1);
		if (gt < 0) break;
		const inner = xml.slice(lt + 1, gt);
		i = gt + 1;
		if (inner[0] === "?" || inner[0] === "!") continue; // <?xml ?>, <!DOCTYPE>
		if (inner[0] === "/") {
			const name = inner.slice(1).trim();
			const at = stack.map((n) => n.tag).lastIndexOf(name);
			if (at > 0) stack.length = at;
			continue;
		}
		const selfClosing = inner.endsWith("/");
		const body = selfClosing ? inner.slice(0, -1) : inner;
		const m = /^\s*([^\s/>]+)/.exec(body);
		if (!m) continue;
		const [opening, tag = ""] = m;
		const attrs: Record<string, string> = {};
		for (const [, name = "", dq, sq, bare] of body.slice(opening.length).matchAll(XML_ATTR))
			attrs[name] = decodeXmlEntities(dq ?? sq ?? bare ?? "");
		const parent = top();
		const node: PolicyNode = {
			tag,
			kind: kindOf(tag, parent === root ? undefined : parent),
			attrs,
			children: [],
		};
		parent.children.push(node);
		if (!selfClosing) stack.push(node);
	}
	return root.children;
}

/** Every node in document order. */
export function* walkPolicy(nodes: PolicyNode[]): Generator<PolicyNode> {
	for (const n of nodes) {
		yield n;
		yield* walkPolicy(n.children);
	}
}

export interface ComboComponent {
	readonly rat: "lte" | "nr";
	readonly band: number;
	/** Downlink bandwidth class, with its MIMO layers when given ("A[4]"). */
	readonly dl: string;
	/** Uplink class when the component carries uplink. */
	readonly ul?: string;
}

/** EN-DC (LTE + NR), NR only, or LTE only. */
export type ComboType = "endc" | "nr" | "lte";

export interface Combo {
	/** Undefined when no component parsed. */
	readonly type?: ComboType;
	readonly components: ComboComponent[];
	/** NR-DC (FR1 + FR2): the `-dc` suffix. */
	readonly nrdc: boolean;
	/** Uplink Tx switching: the `-swul` suffix. */
	readonly swul: boolean;
}

/** One combo string, e.g. `b66AA-b2A-n77AA-swul`; unknown tokens are skipped. */ // band_combos_per_plmn.xml
export function parseCombo(s: string): Combo {
	const out: Building<Combo> = { components: [], nrdc: false, swul: false };
	for (const tok of s.trim().split("-")) {
		if (tok === "dc") {
			out.nrdc = true;
			continue;
		}
		if (tok === "swul") {
			out.swul = true;
			continue;
		}
		const m = /^([bn])(\d+)((?:[A-Z](?:\[[^\]]*\])?)+)$/.exec(tok);
		if (!m) continue;
		const [, rat, band, classes = ""] = m;
		const [dl = "", ul] = classes.match(/[A-Z](?:\[[^\]]*\])?/g) ?? [];
		out.components.push({ rat: rat === "b" ? "lte" : "nr", band: Number(band), dl, ...(ul ? { ul } : {}) });
	}
	const type = comboType(
		out.components.some((x) => x.rat === "lte"),
		out.components.some((x) => x.rat === "nr"),
	);
	if (type !== undefined) out.type = type;
	return out;
}

/** A combination with LTE and NR components is EN-DC; undefined with neither. */
export const comboType = (lte: boolean, nr: boolean): ComboType | undefined =>
	lte && nr ? "endc" : nr ? "nr" : lte ? "lte" : undefined;

/** "n77 n78" / "B2 B66": band numbers as 3GPP writes them (TS 36.101 / 38.101). */
export const bandList = (bands: readonly number[], rat: "lte" | "nr"): string =>
	bands.map((b) => (rat === "nr" ? "n" : "B") + b).join(" ");

export interface BandComboCarrier {
	/** Element name, e.g. "ATT", "KDDI-LEGACY". */
	readonly tag: string;
	/** "310-150" style, as listed in the PLMN-ID element before it. */
	readonly plmns: string[];
	readonly combos: string[];
}

/** `<PLMN-ID>…</PLMN-ID><TAG>combo;combo;…</TAG>` pairs; comments are dropped. */ // bbcfg.mbn: /policyman/band_combos_per_plmn.xml
export function parseBandCombos(xml: string): BandComboCarrier[] {
	const x = xml.replace(/<!--[\s\S]*?-->/g, "");
	const out: BandComboCarrier[] = [];
	for (const [, plmns = "", tag = "", combos = ""] of x.matchAll(
		/<PLMN-ID>([\s\S]*?)<\/PLMN-ID>\s*<([\w-]+)>([\s\S]*?)<\/\2>/g,
	)) {
		out.push({
			tag,
			plmns: plmns.split(/\s+/).filter(Boolean),
			combos: combos
				.split(";")
				.map((c) => c.trim())
				.filter(Boolean),
		});
	}
	return out;
}

export interface ComboStats {
	readonly combos: number;
	/** LTE + NR components (EN-DC). */
	readonly endc: number;
	/** NR-only (SA / NR-CA, single NR bands included). */
	readonly nr: number;
	readonly lte: number;
	readonly nrdc: number;
	readonly swul: number;
	/** Most component carriers in one combo. */
	readonly maxComponents: number;
	/** NR bands used in a multi-carrier combination: more than one component, or intra-band CA (class B and up). */
	readonly nrBands: number[];
	/** NR bands that only appear alone at class A: each tag's section ends with the same single-band list. */
	readonly singleBands: number[];
	/** Multi-carrier NR bands below n257 (FR1). */
	readonly fr1Bands: number[];
	/** Multi-carrier NR bands from n257 up (FR2). */
	readonly fr2Bands: number[];
	/** LTE bands that anchor an EN-DC combo. */
	readonly lteAnchors: number[];
	/** Supplementary-uplink NR bands (n80..n86, n89, n95, n97, n98), when any appear. */
	readonly sulBands: number[];
}

// TS 38.101-1 Table 5.2-1: SUL operating bands
const SUL = new Set([80, 81, 82, 83, 84, 86, 89, 95, 97, 98, 99]);
// TS 38.101-2 Table 5.2-1: FR2 bands start at n257
const FR2_FIRST = 257;

const sorted = (s: Set<number>) => [...s].toSorted((a, b) => a - b);

export function comboStats(combos: string[]): ComboStats {
	const nrBands = new Set<number>(),
		alone = new Set<number>(),
		anchors = new Set<number>();
	const st = { combos: combos.length, endc: 0, nr: 0, lte: 0, nrdc: 0, swul: 0, maxComponents: 0 };
	for (const s of combos) {
		const c = parseCombo(s);
		// `n14AA` on its own says the band exists, not that this carrier combines it with anything.
		const multi = c.components.length > 1 || c.components.some((x) => !x.dl.startsWith("A"));
		for (const x of c.components) if (x.rat === "nr") (multi ? nrBands : alone).add(x.band);
		if (c.type) st[c.type]++;
		if (c.type === "endc") for (const x of c.components) if (x.rat === "lte") anchors.add(x.band);
		if (c.nrdc) st.nrdc++;
		if (c.swul) st.swul++;
		st.maxComponents = Math.max(st.maxComponents, c.components.length);
	}
	const nrs = sorted(nrBands);
	return {
		...st,
		nrBands: nrs,
		singleBands: sorted(alone).filter((b) => !nrBands.has(b)),
		fr1Bands: nrs.filter((b) => b < FR2_FIRST),
		fr2Bands: nrs.filter((b) => b >= FR2_FIRST),
		lteAnchors: sorted(anchors),
		sulBands: nrs.filter((b) => SUL.has(b)),
	};
}

export interface AmprGroup {
	readonly mccs: string[];
	readonly bands: Array<{ readonly band: number; readonly nsNoCa?: number; readonly nsWithCa?: number }>;
}

const childNumber = (n: PolicyNode, tag: string) => {
	const v = n.children.find((c) => c.tag === tag)?.text;
	return v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined;
};

/** `<ampr_configured_ns><mcc id="…"><band id><ns_no_ca/><ns_with_ca/>` */ // pt.mbn: RFNV 64628
export function parseAmprNs(xml: string): AmprGroup[] {
	const root = parsePolicyXml(xml).find((n) => n.tag === "ampr_configured_ns");
	if (!root) return [];
	return root.children
		.filter((m) => m.tag === "mcc")
		.map((m) => ({
			mccs: [...new Set((m.attrs.id ?? "").split(/\s+/).filter(Boolean))],
			bands: m.children
				.filter((b) => b.tag === "band")
				// oxlint-disable-next-line oxc/no-map-spread -- the spreads only leave out absent optional fields; nothing is copied.
				.map((b) => {
					const nsNoCa = childNumber(b, "ns_no_ca"),
						nsWithCa = childNumber(b, "ns_with_ca");
					return {
						band: Number(b.attrs.id),
						...(nsNoCa !== undefined ? { nsNoCa } : {}),
						...(nsWithCa !== undefined ? { nsWithCa } : {}),
					};
				}),
		}));
}

export interface XmlRefs {
	readonly policy?: string;
	readonly carriers?: string[];
	readonly plmns?: string[];
	readonly mccs?: string[];
}

/** Policy name, carrier names, PLMNs and MCCs in the known XML shapes; comments ignored. */
export function xmlRefs(xml: string): XmlRefs {
	const x = xml.replace(/<!--[\s\S]*?-->/g, "");
	const carriers: string[] = [],
		plmns = new Set<string>(),
		mccs = new Set<string>();
	for (const [, list = "", carrier = ""] of x.matchAll(/<PLMN-ID>([\s\S]*?)<\/PLMN-ID>\s*<([\w-]+)>/g)) {
		carriers.push(carrier);
		for (const p of list.split(/\s+/)) if (p) plmns.add(p);
	}
	for (const [, name = ""] of x.matchAll(/carrier_name="([^"]+)"/g)) carriers.push(name); // mcfg_sel_db.xml SelRecord
	for (const [, name = ""] of x.matchAll(/<carrier>([^<]+)<\/carrier>/g)) carriers.push(name.trim()); // data_3gpp_dynamic_config.xml
	for (const [, list = ""] of x.matchAll(/<(?:imsi_3gpp_plmn_in|plmn_list)[^>]*>([^<]*)</g))
		for (const p of list.split(/\s+/)) if (p) plmns.add(p);
	for (const [, list, id = ""] of x.matchAll(/<mcc_list[^>]*>([^<]*)<|<mcc id="([^"]*)"/g))
		for (const p of (list ?? id).split(/\s+/)) if (p) mccs.add(p);
	const policy = /<policy(?:_list)?\b[^>]*\bname\s*=\s*"([^"]*)"/.exec(x)?.[1];
	const out: Building<XmlRefs> = {};
	if (policy !== undefined) out.policy = policy;
	if (carriers.length) out.carriers = carriers;
	if (plmns.size) out.plmns = [...plmns].toSorted();
	if (mccs.size) out.mccs = [...mccs].toSorted((a, b) => a.length - b.length || a.localeCompare(b));
	return out;
}
