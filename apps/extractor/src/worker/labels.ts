/** A code nothing else names, named by a model from a web search, with the page it read the name on. */

import * as v from "valibot";

import type { LabelSubject } from "@carrier-explode/schema/records";

/** What to search for each subject's code. */
const QUERIES = {
  device: (code) => `"${code}" phone model name`,
  carrier: (code) => `"${code}" mobile carrier brand name`,
  modem: (code) => `iPhone modem "${code}" baseband chip model`,
} as const satisfies Record<LabelSubject, (code: string) => string>;

/** What each subject's code is, for the model. */
const WHAT = {
  device: "an Apple product type or a Google Pixel codename; answer with the phone's marketing name, such as \"iPhone 17 Pro\" or \"Pixel 9\"",
  carrier: "the name of an Apple carrier bundle; answer with the brand the carrier sells under, such as \"Cricket Wireless\"",
  modem: "an Apple modem firmware family; answer with the modem chip as sold, such as \"Qualcomm X80\"",
} as const satisfies Record<LabelSubject, string>;

const searchSchema = v.object({ items: v.array(v.object({ url: v.pipe(v.string(), v.url()), title: v.string(), description: v.optional(v.string(), "") })) });
type SearchResult = v.InferOutput<typeof searchSchema>["items"][number];

const answerSchema = v.object({ name: v.nullable(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60))), url: v.nullable(v.string()) });
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
  choices: v.pipe(v.array(v.object({ message: v.object({ content: v.pipe(v.string(), v.parseJson()) }) })), v.minLength(1)),
});

function prompt(subject: LabelSubject, code: string, results: readonly SearchResult[]): string {
  const pages = results.map((r, i) => `[${i + 1}] ${r.url}\n${r.title}\n${r.description}`).join("\n\n");
  return [
    `"${code}" is ${WHAT[subject]}.`,
    "Name it only if one of these search results says so plainly. Reply with that name and the URL of the result that says it;",
    "if none does, reply with null for both. Never guess.",
    "",
    pages,
  ].join("\n");
}

/** The two calls naming takes: a web search, and a model's reply to a prompt. Both return their JSON as is. */
export interface Labeller {
  readonly search: (query: string) => Promise<unknown>;
  readonly ask: (prompt: string) => Promise<unknown>;
}

/** The name the search and the model agree on, and the page that gives it; null when no result names the code. Only a URL the search returned counts. */
export async function nameCode(labeller: Labeller, subject: LabelSubject, code: string): Promise<{ readonly value: string; readonly evidence: string } | null> {
  const { items } = v.parse(searchSchema, await labeller.search(QUERIES[subject](code)));
  if (!items.length) return null;
  const answer = v.parse(answerSchema, v.parse(replySchema, await labeller.ask(prompt(subject, code, items))).choices[0]?.message.content);
  if (answer.name === null || answer.url === null || !items.some((r) => r.url === answer.url)) return null;
  return { value: answer.name, evidence: answer.url };
}
