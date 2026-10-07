/** A small XML reader for OMC's files: elements, attributes and text; comments, declarations and DOCTYPEs skipped. */

export class XmlError extends Error {
	override name = "XmlError";
}

export interface XmlElement {
	readonly name: string;
	readonly attrs: Readonly<Record<string, string>>;
	readonly children: readonly XmlElement[];
	/** The element's own text, trimmed; "" when it has children only. */
	readonly text: string;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescape(s: string): string {
	return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, e: string) => {
		if (e.startsWith("#x") || e.startsWith("#X")) return String.fromCodePoint(parseInt(e.slice(2), 16));
		if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
		return ENTITIES[e] ?? whole;
	});
}

const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

interface Open {
	readonly name: string;
	readonly attrs: Record<string, string>;
	readonly children: XmlElement[];
	text: string;
}

/** Where `token` starts at or after `from`; a missing one is a truncated file. */
function find(xml: string, token: string, from: number): number {
	const i = xml.indexOf(token, from);
	if (i < 0) throw new XmlError(`no ${token} after ${from}`);
	return i;
}

const close = (o: Open): XmlElement => ({
	name: o.name,
	attrs: o.attrs,
	children: o.children,
	text: o.text.trim(),
});

export function parseXml(xml: string): XmlElement {
	const stack: Open[] = [];
	let root: XmlElement | undefined;
	let at = 0;
	while (at < xml.length) {
		const lt = xml.indexOf("<", at);
		const top = stack.at(-1);
		if (lt < 0 || lt > at) {
			const text = xml.slice(at, lt < 0 ? xml.length : lt);
			if (top) top.text += unescape(text);
			else if (text.trim()) throw new XmlError(`text outside the root element at ${at}`);
			if (lt < 0) break;
		}
		if (xml.startsWith("<!--", lt)) {
			at = find(xml, "-->", lt) + 3;
		} else if (xml.startsWith("<![CDATA[", lt)) {
			const end = find(xml, "]]>", lt);
			if (top) top.text += xml.slice(lt + 9, end);
			at = end + 3;
		} else if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
			at = find(xml, ">", lt) + 1;
		} else {
			const gt = find(xml, ">", lt);
			const tag = xml.slice(lt + 1, gt);
			at = gt + 1;
			if (tag.startsWith("/")) {
				const open = stack.pop();
				if (open?.name !== tag.slice(1).trim())
					throw new XmlError(`</${tag.slice(1)}> closes <${open?.name ?? "nothing"}>`);
				const done = close(open);
				const parent = stack.at(-1);
				if (parent) parent.children.push(done);
				else root = done;
				continue;
			}
			const selfClosing = tag.endsWith("/");
			const body = selfClosing ? tag.slice(0, -1) : tag;
			const name = /^[\w:.-]+/.exec(body)?.[0];
			if (name === undefined) throw new XmlError(`a tag without a name at ${lt}`);
			const attrs: Record<string, string> = {};
			for (const m of body.slice(name.length).matchAll(ATTR))
				attrs[m[1] ?? ""] = unescape(m[2] ?? m[3] ?? "");
			const open: Open = { name, attrs, children: [], text: "" };
			if (!selfClosing) stack.push(open);
			else if (top) top.children.push(close(open));
			else root = close(open);
		}
	}
	if (stack.length) throw new XmlError(`<${stack.at(-1)?.name ?? ""}> is never closed`);
	if (!root) throw new XmlError("no root element");
	return root;
}

export const child = (e: XmlElement, name: string): XmlElement | undefined =>
	e.children.find((c) => c.name === name);

/** The text of the first child named `name`, if it has any. */
export function childText(e: XmlElement, name: string): string | undefined {
	const text = child(e, name)?.text;
	return text === undefined || text === "" ? undefined : text;
}

export const childrenNamed = (e: XmlElement, name: string): XmlElement[] =>
	e.children.filter((c) => c.name === name);

/** An XML element as a value tree: a leaf is its text, an element its children by name, a repeated name a list. */
export type XmlValue = string | readonly XmlValue[] | { readonly [name: string]: XmlValue };

export function xmlValue(e: XmlElement, omit: (name: string) => boolean = () => false): XmlValue {
	if (e.children.length === 0) return e.text;
	const byName = new Map<string, XmlElement[]>();
	for (const c of e.children) if (!omit(c.name)) byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
	return Object.fromEntries(
		[...byName].map(([name, cs]) => {
			const [only, ...more] = cs;
			return [
				name,
				only !== undefined && more.length === 0 ? xmlValue(only, omit) : cs.map((c) => xmlValue(c, omit)),
			];
		}),
	);
}
