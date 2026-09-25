/**
 * Qualcomm policyman XML as the baseband package ships it: a lenient XML tree
 * parser (no DOM) that tags each node with its role in a rule, plus the
 * band_combos_per_plmn.xml and A-MPR NS tables. Self-contained, no dependencies.
 */

/* -------------------------------------------------------------- XML tree */

/** Role of a node in a policyman rule. */
export type PolicyKind =
  | "policy" // <policy>, <policy_list>
  | "branch" // if / then / else / select / case
  | "logic" // any_of / all_of / not
  | "condition" // a test under if, case or a logic node
  | "action" // a statement under then, else, actions or policy
  | "define" // a declaration under initial
  | "comment"
  | "data"; // everything else: list members, plain config XML

export interface PolicyNode {
  tag: string;
  kind: PolicyKind;
  attrs: Record<string, string>;
  /** Trimmed text content, when there is any. */
  text?: string;
  children: PolicyNode[];
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

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function unescape(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const ATTR = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * Parses XML into a node list (normally one root). Tolerates the things the
 * firmware files do: trailing NULs, unclosed or stray end tags, bare `&`.
 */
export function parsePolicyXml(xml: string): PolicyNode[] {
  const root: PolicyNode = { tag: "#root", kind: "data", attrs: {}, children: [] };
  const stack: PolicyNode[] = [root];
  const top = () => stack[stack.length - 1];
  const addText = (s: string) => {
    const t = unescape(s).trim();
    if (!t) return;
    const n = top();
    n.text = n.text ? `${n.text} ${t}` : t;
  };
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) { addText(xml.slice(i).replace(/\0+$/, "")); break; }
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
      if (body) top().text = top().text ? `${top().text} ${body}` : body;
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
    const tag = m[1];
    const attrs: Record<string, string> = {};
    for (const a of body.slice(m[0].length).matchAll(ATTR)) attrs[a[1]] = unescape(a[2] ?? a[3] ?? a[4] ?? "");
    const parent = top();
    const node: PolicyNode = { tag, kind: kindOf(tag, parent === root ? undefined : parent), attrs, children: [] };
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

/* ---------------------------------------------------- band_combos_per_plmn */

export interface ComboComponent {
  rat: "lte" | "nr";
  band: number;
  /** Downlink bandwidth class, with its MIMO layers when given ("A[4]"). */
  dl: string;
  /** Uplink class when the component carries uplink. */
  ul?: string;
}

export interface Combo {
  components: ComboComponent[];
  /** NR-DC (FR1 + FR2): the `-dc` suffix. */
  nrdc: boolean;
  /** Uplink Tx switching: the `-swul` suffix. */
  swul: boolean;
}

/** One combo string, e.g. `b66AA-b2A-n77AA-swul`; unknown tokens are skipped. */ // band_combos_per_plmn.xml
export function parseCombo(s: string): Combo {
  const out: Combo = { components: [], nrdc: false, swul: false };
  for (const tok of s.trim().split("-")) {
    if (tok === "dc") { out.nrdc = true; continue; }
    if (tok === "swul") { out.swul = true; continue; }
    const m = /^([bn])(\d+)((?:[A-Z](?:\[[^\]]*\])?)+)$/.exec(tok);
    if (!m) continue;
    const cls = m[3].match(/[A-Z](?:\[[^\]]*\])?/g)!;
    out.components.push({ rat: m[1] === "b" ? "lte" : "nr", band: Number(m[2]), dl: cls[0], ...(cls[1] ? { ul: cls[1] } : {}) });
  }
  return out;
}

export interface BandComboCarrier {
  /** Element name, e.g. "ATT", "KDDI-LEGACY". */
  tag: string;
  /** "310-150" style, as listed in the PLMN-ID element before it. */
  plmns: string[];
  combos: string[];
}

/** `<PLMN-ID>…</PLMN-ID><TAG>combo;combo;…</TAG>` pairs; comments are dropped. */ // bbcfg.mbn: /policyman/band_combos_per_plmn.xml
export function parseBandCombos(xml: string): BandComboCarrier[] {
  const x = xml.replace(/<!--[\s\S]*?-->/g, "");
  const out: BandComboCarrier[] = [];
  for (const m of x.matchAll(/<PLMN-ID>([\s\S]*?)<\/PLMN-ID>\s*<([\w-]+)>([\s\S]*?)<\/\2>/g)) {
    out.push({
      tag: m[2],
      plmns: m[1].split(/\s+/).filter(Boolean),
      combos: m[3].split(";").map((c) => c.trim()).filter(Boolean),
    });
  }
  return out;
}

export interface ComboStats {
  combos: number;
  /** LTE + NR components (EN-DC). */
  endc: number;
  /** NR-only (SA / NR-CA, single NR bands included). */
  nr: number;
  lte: number;
  nrdc: number;
  swul: number;
  /** Most component carriers in one combo. */
  maxComponents: number;
  nrBands: number[];
  /** NR bands >= n257 (FR2). */
  fr2Bands: number[];
  /** LTE bands that anchor an EN-DC combo. */
  lteAnchors: number[];
  /** Supplementary-uplink NR bands (n80..n86, n89, n95, n97, n98), when any appear. */
  sulBands: number[];
}

// TS 38.101-1 Table 5.2-1: SUL operating bands
const SUL = new Set([80, 81, 82, 83, 84, 86, 89, 95, 97, 98, 99]);

const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

export function comboStats(combos: string[]): ComboStats {
  const nrBands = new Set<number>(), anchors = new Set<number>();
  const st = { combos: combos.length, endc: 0, nr: 0, lte: 0, nrdc: 0, swul: 0, maxComponents: 0 };
  for (const s of combos) {
    const c = parseCombo(s);
    const lte = c.components.filter((x) => x.rat === "lte");
    const nr = c.components.filter((x) => x.rat === "nr");
    for (const x of nr) nrBands.add(x.band);
    if (lte.length && nr.length) { st.endc++; for (const x of lte) anchors.add(x.band); }
    else if (nr.length) st.nr++;
    else if (lte.length) st.lte++;
    if (c.nrdc) st.nrdc++;
    if (c.swul) st.swul++;
    st.maxComponents = Math.max(st.maxComponents, c.components.length);
  }
  const nrs = sorted(nrBands);
  return { ...st, nrBands: nrs, fr2Bands: nrs.filter((b) => b >= 257), lteAnchors: sorted(anchors), sulBands: nrs.filter((b) => SUL.has(b)) };
}

/* --------------------------------------------------------- A-MPR NS table */

export interface AmprGroup {
  mccs: string[];
  bands: Array<{ band: number; nsNoCa?: number; nsWithCa?: number }>;
}

/** `<ampr_configured_ns><mcc id="…"><band id><ns_no_ca/><ns_with_ca/>` */ // pt.mbn: RFNV 64628
export function parseAmprNs(xml: string): AmprGroup[] {
  const root = parsePolicyXml(xml).find((n) => n.tag === "ampr_configured_ns");
  if (!root) return [];
  const num = (n: PolicyNode, tag: string) => {
    const v = n.children.find((c) => c.tag === tag)?.text;
    return v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined;
  };
  return root.children
    .filter((m) => m.tag === "mcc")
    .map((m) => ({
      mccs: [...new Set((m.attrs.id ?? "").split(/\s+/).filter(Boolean))],
      bands: m.children
        .filter((b) => b.tag === "band")
        .map((b) => {
          const nsNoCa = num(b, "ns_no_ca"), nsWithCa = num(b, "ns_with_ca");
          return { band: Number(b.attrs.id), ...(nsNoCa !== undefined ? { nsNoCa } : {}), ...(nsWithCa !== undefined ? { nsWithCa } : {}) };
        }),
    }));
}

/* --------------------------------------------------- carriers named in XML */

export interface XmlRefs {
  policy?: string;
  carriers?: string[];
  plmns?: string[];
  mccs?: string[];
}

/** Policy name, carrier names, PLMNs and MCCs in the known XML shapes; comments ignored. */
export function xmlRefs(xml: string): XmlRefs {
  const x = xml.replace(/<!--[\s\S]*?-->/g, "");
  const carriers: string[] = [], plmns = new Set<string>(), mccs = new Set<string>();
  for (const m of x.matchAll(/<PLMN-ID>([\s\S]*?)<\/PLMN-ID>\s*<([\w-]+)>/g)) {
    carriers.push(m[2]);
    for (const p of m[1].split(/\s+/)) if (p) plmns.add(p);
  }
  for (const m of x.matchAll(/carrier_name="([^"]+)"/g)) carriers.push(m[1]); // mcfg_sel_db.xml SelRecord
  for (const m of x.matchAll(/<carrier>([^<]+)<\/carrier>/g)) carriers.push(m[1].trim()); // data_3gpp_dynamic_config.xml
  for (const m of x.matchAll(/<(?:imsi_3gpp_plmn_in|plmn_list)[^>]*>([^<]*)</g)) for (const p of m[1].split(/\s+/)) if (p) plmns.add(p);
  for (const m of x.matchAll(/<mcc_list[^>]*>([^<]*)<|<mcc id="([^"]*)"/g)) for (const p of (m[1] ?? m[2]).split(/\s+/)) if (p) mccs.add(p);
  const policy = /<policy(?:_list)?\b[^>]*\bname\s*=\s*"([^"]*)"/.exec(x)?.[1];
  const out: XmlRefs = {};
  if (policy !== undefined) out.policy = policy;
  if (carriers.length) out.carriers = carriers;
  if (plmns.size) out.plmns = [...plmns].sort();
  if (mccs.size) out.mccs = [...mccs].sort((a, b) => a.length - b.length || a.localeCompare(b));
  return out;
}
