/**
 * MCFG carrier selection: the selection database an HW config carries
 * (`mcfg_sel_db.xml`, a policyman-style rule list) maps SIM matchers to a
 * carrier index, and SW configs carry that index as their header's muxd.
 */

import { trailerField, type McfgImage, type McfgPlmn } from "./mcfg.ts";
import { parsePolicyXml, type PolicyNode } from "./policy.ts";

export const SELECTION_DB_PATH = "/nv/item_files/mcfg/mcfg_sel_db.xml";

/** imsi_3gpp2_plmn_in tests a CDMA SIM's IMSI (Pixel 4, Android 10). */
export const SELECTION_MATCHERS = ["iin_in", "imsi_3gpp_plmn_in", "imsi_3gpp2_plmn_in", "gid_in", "customid_in", "impi_in"] as const;
export type SelectionMatcher = (typeof SELECTION_MATCHERS)[number];
const isMatcher = (tag: string): tag is SelectionMatcher => SELECTION_MATCHERS.some((m) => m === tag);

const LOGIC = { any_of: "any", all_of: "all" } as const;
type LogicTag = keyof typeof LOGIC;
type Logic = (typeof LOGIC)[LogicTag];
const isLogic = (tag: string): tag is LogicTag => tag in LOGIC;

/** A SIM test: one matcher against its listed values, or a combination of tests. */
export type SelectionRule =
  | { readonly kind: "always" }
  | { readonly kind: Logic; readonly rules: readonly SelectionRule[] }
  | { readonly kind: "match"; readonly matcher: SelectionMatcher; readonly variable: string; readonly values: readonly string[] };

export interface SelectionRecord {
  readonly carrierName: string;
  /** The SW config this rule selects: its MCFG header's muxd carrier index. */
  readonly carrierIndex: number;
  readonly rule: SelectionRule;
  /** The record's other attributes as written (country_code, volte, vowifi); those naming a SIM variable (iin="iin") are left out. */
  readonly options: Readonly<Record<string, string>>;
}

export interface SelectionDb {
  readonly records: readonly SelectionRecord[];
}

const elements = (n: PolicyNode): PolicyNode[] => n.children.filter((c) => c.kind !== "comment");

/**
 * `tristate_reset_all` clears the stored SIM values and returns a constant. It is
 * only written as the identity of its parent (false in any_of, true in all_of or
 * alone under if), so it never decides a match.
 */
function isNeutralReset(n: PolicyNode, parent: Logic): boolean {
  return n.tag === "tristate_reset_all" && n.attrs.return === (parent === "any" ? "false" : "true");
}

function rule(n: PolicyNode): SelectionRule {
  if (isLogic(n.tag)) {
    const kind = LOGIC[n.tag];
    return { kind, rules: elements(n).filter((c) => !isNeutralReset(c, kind)).map(rule) };
  }
  if (!isMatcher(n.tag)) throw new Error(`mcfg_sel_db: unknown test <${n.tag}>`);
  const variable = n.attrs.store_in;
  if (variable === undefined) throw new Error(`mcfg_sel_db: <${n.tag}> without store_in`);
  if (n.attrs.not_present !== "false") throw new Error(`mcfg_sel_db: <${n.tag}> not_present="${n.attrs.not_present ?? ""}" is not read`);
  return { kind: "match", matcher: n.tag, variable, values: n.text?.split(/\s+/) ?? [] };
}

function record(n: PolicyNode, variables: ReadonlySet<string>): SelectionRecord {
  const parts = elements(n);
  const then = parts.find((c) => c.tag === "then");
  const sel = then && elements(then).find((c) => c.tag === "SelRecord");
  if (!sel) throw new Error("mcfg_sel_db: <if> without a SelRecord");
  const tests = parts.filter((c) => c !== then && !isNeutralReset(c, "all"));
  const [only, ...more] = tests;
  if (more.length) throw new Error(`mcfg_sel_db: <if> with ${tests.length} tests`);
  const r: SelectionRule = only ? rule(only) : { kind: "always" };
  const { carrier_name: carrierName, mcfg_carrier_index: index, ...rest } = sel.attrs;
  const carrierIndex = Number(index);
  if (carrierName === undefined || index === undefined || !Number.isInteger(carrierIndex)) {
    throw new Error("mcfg_sel_db: SelRecord without carrier_name or mcfg_carrier_index");
  }
  const options = Object.fromEntries(Object.entries(rest).filter(([, v]) => !variables.has(v)));
  return { carrierName, carrierIndex, rule: r, options };
}

/** Reads mcfg_sel_db.xml; throws on a structure it does not model. */
export function parseSelectionDb(xml: string): SelectionDb {
  const policy = parsePolicyXml(xml).find((n) => n.tag === "policy");
  if (!policy) throw new Error("mcfg_sel_db: no <policy>");
  const defines = elements(policy).filter((c) => c.tag === "initial").flatMap(elements);
  const variables = new Set(defines.flatMap((d) => (d.tag === "tristate_define" && d.attrs.name !== undefined ? [d.attrs.name] : [])));
  return { records: elements(policy).filter((c) => c.tag === "if").map((c) => record(c, variables)) };
}

/** Every value a rule lists for one matcher. */
export function ruleValues(r: SelectionRule, matcher: SelectionMatcher): string[] {
  if (r.kind === "match") return r.matcher === matcher ? [...r.values] : [];
  return r.kind === "always" ? [] : r.rules.flatMap((x) => ruleValues(x, matcher));
}

const plmnKey = (p: McfgPlmn): string => `${p.mcc}-${p.mnc}`;
/** "440-10" as the trailer stores it: numbers, so "310-030" reads as 310-30. */
const plmnOf = (s: string): string => s.split("-").map(Number).join("-");

/** Whether a record's IINs or PLMNs meet the SW config's trailer lists. */
function sharesSim(rec: SelectionRecord, image: McfgImage): boolean {
  const iins = new Set(trailerField(image.trailer, "iins")?.iins.map(String));
  const plmns = new Set(trailerField(image.trailer, "plmns")?.plmns.map(plmnKey));
  return ruleValues(rec.rule, "iin_in").some((v) => iins.has(v))
    || ruleValues(rec.rule, "imsi_3gpp_plmn_in").some((v) => plmns.has(plmnOf(v)));
}

/** A config and the records selecting its carrier index; when several configs share it, those whose IINs or PLMNs meet its trailer's. */
interface SelectionPair<T> {
  readonly config: T;
  readonly records: readonly SelectionRecord[];
}

/** Pairs SW configs with the selection records that select them, through the muxd carrier index; configs no record selects are left out. */
export function pairSelection<T extends { readonly image: McfgImage }>(configs: readonly T[], db: SelectionDb): { readonly paired: readonly SelectionPair<T>[] } {
  const byIndex = new Map<number, number>();
  for (const c of configs) byIndex.set(c.image.muxdCarrierIndex, (byIndex.get(c.image.muxdCarrierIndex) ?? 0) + 1);
  const paired = configs.flatMap((config) => {
    const sameIndex = db.records.filter((r) => r.carrierIndex === config.image.muxdCarrierIndex);
    const shared = (byIndex.get(config.image.muxdCarrierIndex) ?? 0) > 1;
    const records = shared ? sameIndex.filter((r) => sharesSim(r, config.image)) : sameIndex;
    return records.length ? [{ config, records }] : [];
  });
  return { paired };
}
