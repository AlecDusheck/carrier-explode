/**
 * Reads carrier config keys from Java sources with regexes: `static final String KEY_* = <expr>;`
 * with string concatenation and prefix constants, plus defaults from `sDefaults.putX(KEY, value)`.
 */

import { typeBySuffix } from "./config-type.ts";
import { parseJavadoc, type Javadoc } from "./javadoc.ts";

/** `[public] static final [java.lang.]String NAME = <expr>;` */
const DECLARATION = /(?:public\s+)?static\s+final\s+(?:java\.lang\.)?String\s+(\w+)\s*=\s*([^;]+);/g;

class JavaParseError extends Error {
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

const TOKENS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g;

/** Blanks comments (and literals too, when `literals`), keeping offsets, so matching only sees code. */
function blank(src: string, literals: boolean): string {
	return src.replace(TOKENS, (m) => (m.startsWith("/") || literals ? m.replace(/[^\n]/g, " ") : m));
}

function classSpans(bare: string): ClassSpan[] {
	const spans: ClassSpan[] = [];
	for (const m of bare.matchAll(/\bclass\s+(\w+)[^{;]*\{/g)) {
		const name = m[1];
		if (name === undefined) continue;
		const open = m.index + m[0].length - 1;
		let depth = 0;
		let i = open;
		for (; i < bare.length; i++) {
			if (bare[i] === "{") depth++;
			else if (bare[i] === "}" && --depth === 0) break;
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

function stringConstants(code: string, spans: readonly ClassSpan[]): StringConstants {
	const out = new Map<string, { expr: string; cls: string }>();
	for (const m of code.matchAll(DECLARATION)) {
		const [, name, expr] = m;
		const cls = enclosing(spans, m.index)?.name ?? "";
		if (name !== undefined && expr !== undefined) out.set(`${cls}.${name}`, { expr, cls });
	}
	return out;
}

/** Aliases of aliases deeper than this are not followed. */
const MAX_ALIAS_DEPTH = 8;

/** A string literal or a (possibly class-qualified) constant name, then `+` or the end. */
const TERM = /\s*(?:"((?:\\.|[^"\\])*)"|(?:(\w+)\.)?(\w+))\s*(\+|$)/;

/** Evaluates `+`-joined string literals and String constants (bare names: `cls`, then the outer class). */
function evalString(
	expr: string,
	cls: string,
	consts: StringConstants,
	outer: string,
	depth = 0,
): string | undefined {
	if (depth > MAX_ALIAS_DEPTH) return undefined;
	// Sticky, and one per call: the recursion below must not move this call's position.
	const term = new RegExp(TERM, "y");
	let out = "";
	while (term.lastIndex < expr.length) {
		const m = term.exec(expr);
		if (m === null) return undefined;
		const [, literal, qualifier, name, plus] = m;
		if (literal !== undefined) out += unescape(literal);
		else {
			const target =
				qualifier !== undefined
					? consts.get(`${qualifier}.${name}`)
					: (consts.get(`${cls}.${name}`) ?? consts.get(`${outer}.${name}`));
			const value = target && evalString(target.expr, target.cls, consts, outer, depth + 1);
			if (value === undefined) return undefined;
			out += value;
		}
		if (plus === "") return out;
	}
	return undefined;
}

/** What precedes a declaration back to the previous statement: its javadoc, and whether it is @Deprecated. */
function preamble(
	src: string,
	bare: string,
	pos: number,
): { readonly doc: string | undefined; readonly deprecated: boolean } {
	const start =
		Math.max(bare.lastIndexOf(";", pos), bare.lastIndexOf("{", pos), bare.lastIndexOf("}", pos)) + 1;
	const open = src.lastIndexOf("/**", pos);
	return {
		doc: open >= start ? src.slice(open, src.indexOf("*/", open) + 2) : undefined,
		deprecated: /@Deprecated\b/.test(bare.slice(start, pos)),
	};
}

/** Literals only: numbers, strings, booleans and null. */
const LITERAL = /^(?:-?[\d.]+[LlFfDd]?|"(?:\\.|[^"\\])*"|true|false|null)$/;
const MAX_DEFAULT = 120;

/** A Java default expression as short display text (`3000`, `["dun"]`), or undefined when it is code, not a value. */
function displayDefault(expr: string): string | undefined {
	const s = expr.replace(/\s+/g, " ").trim();
	const array = /^new \w+\[\] ?\{(.*)\}$/.exec(s)?.[1] ?? (/^new \w+\[0\]$/.test(s) ? "" : undefined);
	const items =
		array === undefined
			? [s]
			: array
					.split(",")
					.map((x) => x.trim())
					.filter((x) => x.length > 0);
	if (!items.every((x) => LITERAL.test(x))) return undefined;
	const values = items.map((x) => x.replace(/^(-?[\d.]+)[LlFfDd]$/, "$1"));
	const text = array === undefined ? values.join("") : `[${values.join(", ")}]`;
	return text.length > MAX_DEFAULT ? undefined : text;
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
	const code = blank(src, false);
	const bare = blank(src, true);
	const spans = classSpans(bare);
	const consts = stringConstants(code, spans);
	const outer = spans[0]?.name ?? "";
	const constants = new Map<string, { key: string; javadoc: Javadoc }>();
	const skipped: string[] = [];
	for (const m of code.matchAll(DECLARATION)) {
		const [, name, expr] = m;
		if (name === undefined || expr === undefined) continue;
		const cls = enclosing(spans, m.index)?.name ?? "";
		const key = evalString(expr, cls, consts, outer);
		if (key === undefined) {
			if (name.startsWith("KEY_") && name !== "KEY_PREFIX")
				skipped.push(`${cls}.${name} = ${expr.replace(/\s+/g, " ").trim()}`);
			continue;
		}
		if (!isKey(name, key)) continue;
		const { doc, deprecated } = preamble(src, bare, m.index);
		const javadoc = doc === undefined ? { text: "", deprecated: false, hidden: false } : parseJavadoc(doc);
		constants.set(`${cls}.${name}`, {
			key,
			javadoc: { ...javadoc, deprecated: javadoc.deprecated || deprecated },
		});
	}
	const defaults = new Map<string, { value?: string; setter: string }>();
	for (const m of code.matchAll(
		/\b(?:sDefaults|defaults)\.put(\w+)\(\s*(?:(\w+)\.)?(\w+)\s*,\s*([\s\S]*?)\);/g,
	)) {
		const [, setter, qualifier, name, expr] = m;
		if (setter === undefined || name === undefined || expr === undefined) continue;
		const cls = qualifier ?? enclosing(spans, m.index)?.name ?? "";
		const target = constants.get(`${cls}.${name}`) ?? constants.get(`${outer}.${name}`);
		if (!target) continue;
		const value = displayDefault(expr);
		defaults.set(target.key, value === undefined ? { setter } : { value, setter });
	}
	// oxlint-disable-next-line oxc/no-map-spread -- flattens each constant's own javadoc into its row; nothing shared is copied.
	const keys = [...constants].map(([constant, { key, javadoc }]): KeyConstant => {
		const def = defaults.get(key);
		return {
			constant,
			key,
			...javadoc,
			...(def?.value === undefined ? {} : { default: def.value }),
			...(def === undefined ? {} : { setter: def.setter }),
		};
	});
	return { keys, skipped };
}
