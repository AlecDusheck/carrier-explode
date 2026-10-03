/**
 * Reads carrier config keys from Java sources with regexes: `static final String KEY_* = <expr>;`
 * with string concatenation and prefix constants, plus defaults from `sDefaults.putX(KEY, value)`.
 */

import { typeBySuffix } from "./config-type.ts";
import { parseJavadoc, type Javadoc } from "./javadoc.ts";

/** `[public] static final [java.lang.]String NAME = <expr>;` */
const DECLARATION = /(?:public\s+)?static final (?:java\.lang\.)?String\s+(\w+)\s*=\s*([^;]+);/g;

export class JavaParseError extends Error {
  override name = "JavaParseError";
}

/** A class body: name and the character range of its braces. */
interface ClassSpan {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

export interface KeyConstant extends Javadoc {
  /** Java constant, qualified by its classes: `CarrierConfigManager.KEY_FOO_BOOL`, `Ims.KEY_BAR_INT` (innermost only). */
  readonly constant: string;
  /** The key string itself: `foo_bool`, `ims.bar_int`. */
  readonly key: string;
  readonly default?: string;
  /** The PersistableBundle setter the defaults use (`Boolean`, `IntArray`...): the type when the key's name has no suffix. */
  readonly setter?: string;
}

/** Blanks comments and literals, keeping offsets, so brace matching only sees code. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (m) => m.replace(/[^\n]/g, " "));
}

function classSpans(src: string): ClassSpan[] {
  const code = codeOnly(src);
  const spans: ClassSpan[] = [];
  for (const m of code.matchAll(/\bclass\s+(\w+)[^{;]*\{/g)) {
    const name = m[1];
    if (name === undefined) continue;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) break;
    }
    if (depth !== 0) throw new JavaParseError(`class ${name} at ${m.index} never closes`);
    spans.push({ name, start: open, end: i });
  }
  return spans;
}

/** The innermost class enclosing `pos`; the outermost is CarrierConfigManager itself. */
function enclosing(spans: readonly ClassSpan[], pos: number): ClassSpan | undefined {
  let best: ClassSpan | undefined;
  for (const s of spans) if (s.start < pos && pos < s.end && (!best || s.start > best.start)) best = s;
  return best;
}

/** Java string literal body -> its value (only the escapes the file uses). */
function unescape(s: string): string {
  return s.replace(/\\(.)/g, (_m, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
}

/** Every `static final String NAME = <expr>` by `Class.NAME`, unevaluated. */
type StringConstants = ReadonlyMap<string, { readonly expr: string; readonly cls: string }>;

function stringConstants(src: string, spans: readonly ClassSpan[]): StringConstants {
  const out = new Map<string, { expr: string; cls: string }>();
  for (const m of src.matchAll(DECLARATION)) {
    const [, name, expr] = m;
    const cls = enclosing(spans, m.index)?.name ?? "";
    if (name !== undefined && expr !== undefined) out.set(`${cls}.${name}`, { expr, cls });
  }
  return out;
}

/** Evaluates `+`-joined string literals and String constants (bare names: `cls`, then the outer class). */
function evalString(expr: string, cls: string, consts: StringConstants, outer: string, depth = 0): string | undefined {
  if (depth > 8) return undefined;
  let out = "";
  for (const part of expr.split("+").map((p) => p.trim())) {
    const literal = part.match(/^"((?:\\.|[^"\\])*)"$/);
    if (literal?.[1] !== undefined) {
      out += unescape(literal[1]);
      continue;
    }
    const ref = part.match(/^(?:(\w+)\.)?(\w+)$/);
    const name = ref?.[2];
    if (!ref || name === undefined) return undefined;
    const target = ref[1] !== undefined ? consts.get(`${ref[1]}.${name}`) : consts.get(`${cls}.${name}`) ?? consts.get(`${outer}.${name}`);
    const value = target && evalString(target.expr, target.cls, consts, outer, depth + 1);
    if (value === undefined) return undefined;
    out += value;
  }
  return out;
}

/** The javadoc directly above `pos`, allowing annotations in between. */
function javadocBefore(src: string, pos: number): string | undefined {
  const end = src.lastIndexOf("*/", pos);
  if (end < 0) return undefined;
  const between = src.slice(end + 2, pos);
  if (!/^(\s|@\w+(\([^)]*\))?)*$/.test(between)) return undefined;
  const start = src.lastIndexOf("/**", end);
  return start < 0 ? undefined : src.slice(start, end + 2);
}

/** A Java default expression as short display text, or undefined when it is code, not a value. */
function displayDefault(expr: string): string | undefined {
  const s = expr.replace(/\s+/g, " ").trim()
    .replace(/^new (?:int|long|String)\[\] ?\{(.*)\}$/, "[$1]")
    .replace(/^new (?:int|long|String)\[0\]$/, "[]");
  if (s.length > 120) return undefined;
  // Literals only: numbers, strings, booleans, null, and arrays of those.
  const literal = /^(?:-?[\d.]+[LlFfDd]?|"(?:\\.|[^"\\])*"|true|false|null)$/;
  const items = s.startsWith("[") ? s.slice(1, -1).split(",").map((x) => x.trim()).filter(Boolean) : [s];
  return items.every((x) => literal.test(x)) ? s.replace(/(\d)[LlFfDd]\b/g, "$1") : undefined;
}

export interface ParsedSource {
  readonly keys: readonly KeyConstant[];
  /** KEY_* constants whose value is not literals, prefixes and aliases; listed, not guessed. */
  readonly skipped: readonly string[];
}

/** A config key: any KEY_* but the prefixes, or a constant whose value is a typed key (`IMSI_KEY_AVAILABILITY_INT`). */
function isKey(name: string, value: string): boolean {
  if (name === "KEY_PREFIX" || name === "PREFIX") return false;
  return name.startsWith("KEY_") || (/^[a-z][a-z0-9_.]*$/.test(value) && typeBySuffix(value) !== undefined);
}

export function parseConfigSource(src: string): ParsedSource {
  const spans = classSpans(src);
  const consts = stringConstants(src, spans);
  const outer = spans[0]?.name ?? "";
  const constants = new Map<string, { key: string; javadoc: Javadoc }>();
  const skipped: string[] = [];
  for (const m of src.matchAll(DECLARATION)) {
    const [, name, expr] = m;
    if (name === undefined || expr === undefined) continue;
    const cls = enclosing(spans, m.index)?.name ?? "";
    const key = evalString(expr, cls, consts, outer);
    if (key === undefined) {
      if (name.startsWith("KEY_") && name !== "KEY_PREFIX") skipped.push(`${cls}.${name} = ${expr.replace(/\s+/g, " ").trim()}`);
      continue;
    }
    if (!isKey(name, key)) continue;
    const doc = javadocBefore(src, m.index);
    const javadoc = doc ? parseJavadoc(doc) : { text: "", deprecated: false, hidden: false };
    const deprecated = javadoc.deprecated || /@Deprecated\s*$/.test(src.slice(Math.max(0, m.index - 200), m.index));
    constants.set(`${cls}.${name}`, { key, javadoc: { ...javadoc, deprecated } });
  }
  const defaults = new Map<string, { value?: string; setter: string }>();
  for (const m of src.matchAll(/\b(?:sDefaults|defaults)\.put(\w+)\(\s*(?:(\w+)\.)?(\w+)\s*,\s*([\s\S]*?)\);/g)) {
    const [, setter, qualifier, name, expr] = m;
    if (setter === undefined || name === undefined || expr === undefined) continue;
    const cls = qualifier ?? enclosing(spans, m.index)?.name ?? "";
    const target = constants.get(`${cls}.${name}`) ?? constants.get(`${outer}.${name}`);
    if (!target) continue;
    const value = displayDefault(expr);
    defaults.set(target.key, value === undefined ? { setter } : { value, setter });
  }
  const keys = [...constants].map(([constant, { key, javadoc }]): KeyConstant => {
    const def = defaults.get(key);
    return {
      constant, key, ...javadoc,
      ...(def?.value === undefined ? {} : { default: def.value }),
      ...(def === undefined ? {} : { setter: def.setter }),
    };
  });
  return { keys, skipped };
}
