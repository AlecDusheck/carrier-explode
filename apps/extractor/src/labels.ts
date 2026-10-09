/** A code nothing else names, named by a model from a web search, with the page it read the name on. */

import * as v from "valibot";

import type { LabelCandidate, LabelCandidateKind } from "@carrier-explode/db";
import { countryName } from "@carrier-explode/schema";

/**
 * A search for a code's name, and what the code is (for the model). How a result writes the code (`mark`) and what starts
 * a record of it (`records`): the name must stand in the code's record. A page must mention `about`, if set, at all.
 */
interface Search {
	readonly query: string;
	readonly what: string;
	readonly mark: RegExp;
	readonly records: RegExp;
	readonly about: RegExp | null;
}

type Written = Pick<Search, "mark" | "records">;

const escaped = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const literal = (s: string): RegExp => new RegExp(escaped(s), "gi");

/** A code as written; its records start at codes of its shape, numbers any (`Mav23`: `Mav24`), or else at each line. */
function written(code: string): Written {
	const mark = literal(code);
	return {
		mark,
		records: /\d/.test(code)
			? new RegExp(`(?<![a-z0-9])${escaped(code).replace(/\d+/g, "\\d+")}(?![a-z0-9])`, "gi")
			: new RegExp(`${mark.source}|\n`, "gi"),
	};
}

/** `202 10`, `202-10`, `MCC 202 MNC 10`, `284 | 5`; any of the country's networks when `mnc` is null. */
function plmn(mcc: string, mnc: string | null): RegExp {
	const network = mnc === null ? "\\d{1,3}" : `0*${mnc.replace(/^0+(?=\d)/, "")}`;
	return new RegExp(`(?<!\\d)${mcc}\\D{0,12}${network}(?!\\d)`, "g");
}

/** A network as written; its records start at its country's networks. */
const network = (mcc: string, mnc: string): Written => ({ mark: plmn(mcc, mnc), records: plmn(mcc, null) });

const inCountry = (iso: string | null): string => {
	const country = iso === null ? undefined : countryName(iso);
	return country === undefined ? "" : ` in ${country}`;
};

/** Android's carrier list names a carrier it has no name for by the SIM rule that selects it: `311140SPN=SPROCKET`. */
const SIM_RULE = /^(\d{3})(\d{2,3})(?:(SPN|IMSI|GID1|ICCID)=(.+))?$/;

function carrierSearch({ code, platform, iso }: LabelCandidate): Search {
	const where = inCountry(iso);
	switch (platform) {
		case "samsung":
			return {
				query: `Samsung CSC "${code}" sales code carrier`,
				what: `a Samsung CSC (sales code) of Galaxy firmware${where}; answer with the carrier or market it is for`,
				...written(code),
				about: null,
			};
		case "android": {
			const rule = SIM_RULE.exec(code);
			if (rule === null) {
				const name = code.replace(/_[a-z]{2}$/, "");
				return {
					query: `"${name}" mobile carrier${where}`,
					what: `Android's carrier id for a carrier${where}; answer with the brand the carrier sells under, such as "Cricket Wireless"`,
					...written(name),
					about: null,
				};
			}
			const [, mcc = "", mnc = "", selector, value] = rule;
			const codes = `MCC ${mcc} MNC ${mnc}`;
			return selector === undefined || value === undefined
				? {
						query: `${codes} mobile network operator`,
						what: `the mobile network ${codes}${where}; answer with the operator's brand`,
						...network(mcc, mnc),
						about: null,
					}
				: {
						query:
							selector === "SPN"
								? `"${value}" mobile carrier ${codes}`
								: `${codes} ${selector} ${value} MVNO`,
						what: `the carrier on mobile network ${codes}${where} whose SIMs have ${selector} ${value}; answer with that carrier's brand`,
						...(selector === "SPN" ? written(value) : network(mcc, mnc)),
						about: null,
					};
		}
		case "ios":
		case "ipados":
		case "watchos":
			return {
				query: `"${code}" mobile carrier brand name`,
				what: `the name of an Apple carrier bundle${where}; answer with the brand the carrier sells under, such as "Cricket Wireless"`,
				...written(code),
				about: null,
			};
	}
}

function modemConfigSearch({ code, platform }: LabelCandidate): Search {
	const sbp = /^SBP (\d+)$/.exec(code)?.[1];
	if (sbp !== undefined)
		return {
			query: `MediaTek SBP ID ${sbp} operator`,
			what: `MediaTek's SBP id ${sbp}, its modems' number for a mobile operator; answer with that operator`,
			mark: new RegExp(`(?<!\\d)${sbp}(?!\\d)`, "g"),
			records: written(sbp).records,
			// SMS gateways and other vendors number operators in lists of the same shape.
			about: /mediatek|\bsbp\b/,
		};
	// A Galaxy phone's modem is Qualcomm's; a Pixel's may be Samsung's, Qualcomm's or MediaTek's.
	const modem = platform === "samsung" ? "Galaxy Qualcomm MCFG" : "Pixel modem";
	return {
		query: `${modem} carrier configuration "${code}"`,
		what: `a ${modem} carrier configuration that names no network; answer with the one carrier it is for, or null if it is for none or several`,
		...written(code),
		about: null,
	};
}

const SEARCHES = {
	device: ({ code, platform }) =>
		platform === "android"
			? {
					query: `"${code}" Pixel codename`,
					what: 'a Google Pixel codename; answer with the phone\'s marketing name, such as "Pixel 9"',
					...written(code),
					about: null,
				}
			: {
					query: `"${code}" model name`,
					what: `${platform === "samsung" ? "a Samsung model number" : "an Apple model identifier"}; answer with the product's marketing name, such as "iPhone 17 Pro"`,
					...written(code),
					about: null,
				},
	carrier: carrierSearch,
	modemFamily: ({ code, platform }) =>
		platform === "ios"
			? {
					query: `iPhone baseband modem "${code}"`,
					what: 'the name of an Apple modem firmware family; answer with the modem chip as sold, such as "Qualcomm X80"',
					...written(code),
					about: null,
				}
			: {
					query: `"${code}" chipset codename modem`,
					what: 'the codename a Galaxy phone\'s modem firmware gives its chipset; answer with the modem chip as sold, such as "Qualcomm X80"',
					...written(code),
					about: null,
				},
	modemConfig: modemConfigSearch,
} as const satisfies Record<LabelCandidateKind, (c: LabelCandidate) => Search>;

const searchSchema = v.object({
	items: v.array(
		v.object({
			url: v.pipe(v.string(), v.url()),
			title: v.string(),
			description: v.optional(v.string(), ""),
		}),
	),
});
type SearchResult = v.InferOutput<typeof searchSchema>["items"][number];

const answerSchema = v.object({
	name: v.nullable(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60))),
	url: v.nullable(v.string()),
});
/** OpenAI's structured-output format, which the current Workers AI chat models take. */
export const ANSWER_FORMAT = {
	type: "json_schema",
	json_schema: {
		name: "label",
		strict: true,
		schema: {
			type: "object",
			properties: { name: { type: ["string", "null"] }, url: { type: ["string", "null"] } },
			required: ["name", "url"],
			additionalProperties: false,
		},
	},
} as const;

/** A chat completion: the answer is the first choice's content, as JSON. */
const replySchema = v.object({
	choices: v.pipe(
		v.array(v.object({ message: v.object({ content: v.pipe(v.string(), v.parseJson()) }) })),
		v.minLength(1),
	),
});

function prompt(code: string, what: string, results: readonly SearchResult[]): string {
	const pages = results.map((r, i) => `[${i + 1}] ${r.url}\n${r.title}\n${r.description}`).join("\n\n");
	return [
		`"${code}" is ${what}.`,
		`Name it only if one of these search results gives that name to "${code}" plainly. Reply with the name spelled the way that result spells it,`,
		"and its URL; if none does, reply with null for both. Never guess.",
		"",
		pages,
	].join("\n");
}

/** The two calls naming takes: a web search, and a model's reply to a prompt. Both return their JSON as is. */
export interface Labeller {
	readonly search: (query: string) => Promise<unknown>;
	readonly ask: (prompt: string) => Promise<unknown>;
}

/** Lower case, quotes straight, spaces run together; lines kept, since a list of codes gives each its own. */
const folded = (s: string): string =>
	s
		.toLowerCase()
		.replace(/[‘’‛ʼ]/g, "'")
		.replace(/[“”„]/g, '"')
		.replace(/[^\S\n]+/g, " ");

/** How far a name may follow its code within the code's record, and precede it on its line. */
const AFTER = 120;
const BEFORE = 60;

/** Whether `name` is in the code's record: the nearest code before it is the code, or with none, the next on its line is. */
function inRecord(text: string, { mark, records }: Written, name: string): boolean {
	const ours = new RegExp(`^(?:${mark.source})$`, mark.flags.replace("g", ""));
	const starts = [...text.matchAll(records)].map((m) => ({
		start: m.index,
		end: m.index + m[0].length,
		code: m[0] !== "\n",
		ours: ours.test(m[0]),
	}));
	return [...text.matchAll(literal(name))].some((n) => {
		const before = starts.findLast((r) => r.end <= n.index);
		if (before !== undefined && before.code && n.index - before.end <= AFTER) return before.ours;
		const after = starts.find((r) => r.start >= n.index + n[0].length);
		return (
			after !== undefined &&
			after.ours &&
			after.start - n.index <= BEFORE &&
			!text.slice(n.index, after.start).includes("\n")
		);
	});
}

/**
 * The name a search result gives the code, and that result's URL; null when none does. Only a result the search returned
 * counts, only if its title or text writes the name in the code's record, and only a name that is not the code itself.
 */
export async function nameCode(
	labeller: Labeller,
	candidate: LabelCandidate,
): Promise<{ readonly value: string; readonly evidence: string } | null> {
	const search: Search = SEARCHES[candidate.kind](candidate);
	const { items } = v.parse(searchSchema, await labeller.search(search.query));
	if (!items.length) return null;
	const answer = v.parse(
		answerSchema,
		v.parse(replySchema, await labeller.ask(prompt(candidate.code, search.what, items))).choices[0]?.message
			.content,
	);
	const { name, url } = answer;
	if (name === null || url === null || folded(name) === folded(candidate.code)) return null;
	const cited = items.find((r) => r.url === url);
	if (cited === undefined) return null;
	const text = folded(`${cited.title}\n${cited.description}`);
	if (search.about !== null && !search.about.test(folded(`${cited.url}\n${text}`))) return null;
	if (!inRecord(text, search, folded(name))) return null;
	return { value: name, evidence: url };
}
