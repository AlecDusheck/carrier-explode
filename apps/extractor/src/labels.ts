/** A code nothing else names, named by a model from a web search, with the page it read the name on. */

import * as v from "valibot";

import type { LabelCandidate, LabelCandidateKind } from "@carrier-explode/db";
import { countryName } from "@carrier-explode/schema";

/** A search for a code's name, what the code is (for the model), and how a result writes the code, which the name must stand near. */
interface Search {
	readonly query: string;
	readonly what: string;
	readonly mark: RegExp;
}

const literal = (s: string): RegExp => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
/** `202 10`, `202-10`, `MCC 202 MNC 10`. */
const network = (mcc: string, mnc: string): RegExp => new RegExp(`(?<!\\d)${mcc}\\D{0,12}${mnc}(?!\\d)`, "g");

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
				mark: literal(code),
			};
		case "android": {
			const rule = SIM_RULE.exec(code);
			if (rule === null) {
				const name = code.replace(/_[a-z]{2}$/, "");
				return {
					query: `"${name}" mobile carrier${where}`,
					what: `Android's carrier id for a carrier${where}; answer with the brand the carrier sells under, such as "Cricket Wireless"`,
					mark: literal(name),
				};
			}
			const [, mcc = "", mnc = "", selector, value] = rule;
			const plmn = `MCC ${mcc} MNC ${mnc}`;
			return selector === undefined || value === undefined
				? {
						query: `${plmn} mobile network operator`,
						what: `the mobile network ${plmn}${where}; answer with the operator's brand`,
						mark: network(mcc, mnc),
					}
				: {
						query:
							selector === "SPN" ? `"${value}" mobile carrier ${plmn}` : `${plmn} ${selector} ${value} MVNO`,
						what: `the carrier on mobile network ${plmn}${where} whose SIMs have ${selector} ${value}; answer with that carrier's brand`,
						mark: selector === "SPN" ? literal(value) : network(mcc, mnc),
					};
		}
		case "ios":
		case "ipados":
		case "watchos":
			return {
				query: `"${code}" mobile carrier brand name`,
				what: `the name of an Apple carrier bundle${where}; answer with the brand the carrier sells under, such as "Cricket Wireless"`,
				mark: literal(code),
			};
	}
}

const SEARCHES = {
	device: ({ code, platform }) =>
		platform === "android"
			? {
					query: `"${code}" Pixel codename`,
					what: 'a Google Pixel codename; answer with the phone\'s marketing name, such as "Pixel 9"',
					mark: literal(code),
				}
			: {
					query: `"${code}" model name`,
					what: `${platform === "samsung" ? "a Samsung model number" : "an Apple model identifier"}; answer with the product's marketing name, such as "iPhone 17 Pro"`,
					mark: literal(code),
				},
	carrier: carrierSearch,
	modemFamily: ({ code, platform }) =>
		platform === "ios"
			? {
					query: `iPhone baseband modem "${code}"`,
					what: 'the name of an Apple modem firmware family; answer with the modem chip as sold, such as "Qualcomm X80"',
					mark: literal(code),
				}
			: {
					query: `"${code}" chipset codename modem`,
					what: 'the codename a Galaxy phone\'s modem firmware gives its chipset; answer with the modem chip as sold, such as "Qualcomm X80"',
					mark: literal(code),
				},
	modemConfig: ({ code, platform }) => {
		const sbp = /^SBP (\d+)$/.exec(code)?.[1];
		return sbp === undefined
			? {
					query: `"${code}" modem configuration carrier`,
					what: `a ${platform === "samsung" ? "Galaxy" : "Pixel"} modem configuration that names no network; answer with the one carrier it is for, or null if it is for none or several`,
					mark: literal(code),
				}
			: {
					query: `MediaTek SBP ID ${sbp} operator`,
					what: `MediaTek's SBP id ${sbp}, its modems' number for a mobile operator; answer with that operator`,
					mark: new RegExp(`(?<!\\d)${sbp}(?!\\d)`, "g"),
				};
	},
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

/** Lower case, spaces run together; lines kept, since a list of codes gives each its own. */
const folded = (s: string): string => s.toLowerCase().replace(/[^\S\n]+/g, " ");

/** How far apart a result may write the code and its name, on one line. */
const NEAR = 60;

const nearby = (text: string, mark: RegExp, name: string): boolean => {
	const names = [...text.matchAll(literal(name))].map((m) => m.index);
	return [...text.matchAll(mark)].some((m) =>
		names.some((i) => {
			const between = text.slice(Math.min(i, m.index), Math.max(i, m.index));
			return between.length <= NEAR && !between.includes("\n");
		}),
	);
};

/**
 * The name a search result gives the code, and that result's URL; null when none does. Only a result the search returned
 * counts, only if its title or text writes the name beside the code, and only a name that is not the code itself.
 */
export async function nameCode(
	labeller: Labeller,
	candidate: LabelCandidate,
): Promise<{ readonly value: string; readonly evidence: string } | null> {
	const { query, what, mark } = SEARCHES[candidate.kind](candidate);
	const { items } = v.parse(searchSchema, await labeller.search(query));
	if (!items.length) return null;
	const answer = v.parse(
		answerSchema,
		v.parse(replySchema, await labeller.ask(prompt(candidate.code, what, items))).choices[0]?.message.content,
	);
	const { name, url } = answer;
	if (name === null || url === null || folded(name) === folded(candidate.code)) return null;
	const cited = items.find((r) => r.url === url);
	if (cited === undefined) return null;
	if (!nearby(folded(`${cited.title}\n${cited.description}`), mark, folded(name))) return null;
	return { value: name, evidence: url };
}
