/** Javadoc to plain text: the first paragraphs, plus the @deprecated and @hide flags. */

export interface Javadoc {
	readonly text: string;
	readonly deprecated: boolean;
	readonly hidden: boolean;
}

/** Notes past this are cut at a word boundary: the full javadoc is one click away in AOSP. */
const MAX_NOTE = 600;

const ENTITIES = new Map([
	["&lt;", "<"],
	["&gt;", ">"],
	["&amp;", "&"],
	["&quot;", '"'],
	["&#39;", "'"],
	["&nbsp;", " "],
]);

/** `{@link Foo#bar label}` -> label; `{@link #KEY_X}` -> KEY_X; `{@code x}` -> x. */
function inlineTags(s: string): string {
	return s
		.replace(/\{@(?:link|linkplain)\s+([^\s}]+)\s+([^}]+)\}/g, "$2")
		.replace(/\{@(?:link|linkplain)\s+([^}]+)\}/g, (_m, ref: string) =>
			ref.replace(/^#/, "").replace(/#/, "."),
		)
		.replace(/\{@(?:code|literal|value)\s+([^}]*)\}/g, "$1");
}

function html(s: string): string {
	return s
		.replace(/<li>/gi, "\n- ")
		.replace(/<\/?[a-z][^>]*>/gi, " ")
		.replace(/&[#\w]+;/g, (e) => ENTITIES.get(e) ?? e);
}

function clip(s: string): string {
	if (s.length <= MAX_NOTE) return s;
	const cut = s.lastIndexOf(" ", MAX_NOTE);
	return `${s.slice(0, cut > 0 ? cut : MAX_NOTE)}…`;
}

/** `comment` is the raw `/** ... *\/` text. */
export function parseJavadoc(comment: string): Javadoc {
	const body = comment
		.replace(/^\/\*\*/, "")
		.replace(/\*\/$/, "")
		.split("\n")
		.map((line) => line.replace(/^\s*\*\s?/, ""))
		.join("\n");
	const deprecated = /(^|\n)\s*@deprecated\b/.test(body);
	const hidden = /@hide\b/.test(body);
	// The description ends at the first block tag.
	const description = body.split(/\n\s*@\w+/)[0] ?? "";
	const paragraphs = description
		.split(/\n\s*\n|<p>|<P>/)
		.map((p) =>
			html(inlineTags(p))
				.replace(/[ \t\r\n]+/g, " ")
				.trim(),
		)
		.filter((p) => p.length > 0);
	return { text: clip(paragraphs.slice(0, 2).join("\n\n")), deprecated, hidden };
}
