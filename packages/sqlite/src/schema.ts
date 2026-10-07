/** Column names from a CREATE TABLE statement, parsed only as far as reading rows needs. */

import { SqliteError } from "./bytes.ts";

export interface TableColumns {
	readonly columns: readonly string[];
	/** The INTEGER PRIMARY KEY column, which the record stores as NULL because it is the rowid. */
	readonly rowidColumn: number | undefined;
}

/** Words that end a column's name and type and start its constraints. */
const CONSTRAINT_WORDS = new Set([
	"CONSTRAINT",
	"PRIMARY",
	"NOT",
	"NULL",
	"UNIQUE",
	"CHECK",
	"DEFAULT",
	"COLLATE",
	"REFERENCES",
	"GENERATED",
	"AS",
]);
/** Words that start a table constraint instead of a column. */
const TABLE_CONSTRAINT_WORDS = new Set(["CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN"]);
const QUOTES: Readonly<Record<string, string>> = { '"': '"', "'": "'", "`": "`", "[": "]" };

interface Token {
	readonly text: string;
	readonly quoted: boolean;
}

/** Identifiers, quoted names, strings and single punctuation characters; whitespace and comments dropped. */
function tokens(sql: string): Token[] {
	const out: Token[] = [];
	for (let i = 0; i < sql.length;) {
		const c = sql.charAt(i);
		const close = QUOTES[c];
		if (/\s/.test(c)) i++;
		else if (sql.startsWith("--", i)) i = sql.indexOf("\n", i) < 0 ? sql.length : sql.indexOf("\n", i);
		else if (sql.startsWith("/*", i)) i = sql.indexOf("*/", i) < 0 ? sql.length : sql.indexOf("*/", i) + 2;
		else if (close) {
			let text = "";
			let j = i + 1;
			for (;;) {
				const end = sql.indexOf(close, j);
				if (end < 0) throw new SqliteError(`unterminated ${c} in ${sql}`);
				text += sql.slice(j, end);
				// A doubled closing quote is an escaped one.
				if (close !== "]" && sql.charAt(end + 1) === close) {
					text += close;
					j = end + 2;
				} else {
					i = end + 1;
					break;
				}
			}
			out.push({ text, quoted: true });
		} else {
			const word = /^[\p{L}\p{N}_$]+/u.exec(sql.slice(i))?.[0];
			out.push({ text: word ?? c, quoted: false });
			i += word?.length ?? 1;
		}
	}
	return out;
}

const word = (t: Token | undefined): string => (t && !t.quoted ? t.text.toUpperCase() : "");

/** The top-level comma-separated parts of the parenthesised column list, and what follows it. */
function definitions(sql: string): { readonly parts: Token[][]; readonly trailer: Token[] } {
	const all = tokens(sql);
	const open = all.findIndex((t) => !t.quoted && t.text === "(");
	if (open < 0 || word(all[0]) !== "CREATE") throw new SqliteError(`not a CREATE TABLE with columns: ${sql}`);
	const parts: Token[][] = [[]];
	let depth = 0;
	for (let i = open + 1; i < all.length; i++) {
		const t = all[i];
		if (!t) break;
		if (!t.quoted && t.text === "(") depth++;
		if (!t.quoted && t.text === ")") {
			if (depth === 0) return { parts, trailer: all.slice(i + 1) };
			depth--;
		}
		if (depth === 0 && !t.quoted && t.text === ",") parts.push([]);
		else parts.at(-1)?.push(t);
	}
	throw new SqliteError(`unbalanced parentheses in ${sql}`);
}

/** The first name of each comma-separated item in `PRIMARY KEY (a ASC, b)`. */
function keyColumns(constraint: readonly Token[]): string[] {
	const open = constraint.findIndex((t) => !t.quoted && t.text === "(");
	const close = constraint.findIndex((t) => !t.quoted && t.text === ")");
	const names: string[] = [];
	let expectName = true;
	for (const t of constraint.slice(open + 1, close)) {
		if (!t.quoted && t.text === ",") expectName = true;
		else if (expectName) {
			names.push(t.text);
			expectName = false;
		}
	}
	return names;
}

export function tableColumns(sql: string): TableColumns {
	const { parts, trailer } = definitions(sql);
	if (trailer.some((t) => word(t) === "WITHOUT"))
		throw new SqliteError(`WITHOUT ROWID tables are not supported: ${sql}`);
	const columns: string[] = [];
	const types: string[] = [];
	let rowidColumn: number | undefined;
	let tablePrimaryKey: string[] | undefined;
	for (const part of parts) {
		const first = part[0];
		if (!first) throw new SqliteError(`empty column definition in ${sql}`);
		if (TABLE_CONSTRAINT_WORDS.has(word(first))) {
			const at = part.findIndex((t) => word(t) === "PRIMARY");
			if (at >= 0) tablePrimaryKey = keyColumns(part.slice(at));
			continue;
		}
		const rest = part.slice(1);
		const typeEnd = rest.findIndex((t) => CONSTRAINT_WORDS.has(word(t)));
		const type = (typeEnd < 0 ? rest : rest.slice(0, typeEnd)).map((t) => t.text.toUpperCase()).join(" ");
		const constraints = typeEnd < 0 ? [] : rest.slice(typeEnd).map(word);
		if (constraints.includes("GENERATED") || constraints.includes("AS")) {
			throw new SqliteError(`generated columns are not supported: ${sql}`);
		}
		const pk = constraints.indexOf("PRIMARY");
		if (type === "INTEGER" && pk >= 0 && constraints[pk + 2] !== "DESC") rowidColumn = columns.length;
		columns.push(first.text);
		types.push(type);
	}
	if (tablePrimaryKey?.length === 1) {
		const at = columns.findIndex((c) => c.toLowerCase() === tablePrimaryKey[0]?.toLowerCase());
		if (at >= 0 && types[at] === "INTEGER") rowidColumn = at;
	}
	return { columns, rowidColumn };
}
