import { describe, expect, it } from "vitest";
import { type Labeller, nameCode } from "../src/labels.ts";

const RESULTS = {
	items: [
		{
			url: "https://example.com/pixel-11",
			title: "Pixel 11 (cubs)",
			description: "Google's Pixel 11, codenamed cubs",
		},
	],
};
const labeller = (reply: unknown, results: unknown = RESULTS, queries: string[] = []): Labeller => ({
	search: async (query) => {
		queries.push(query);
		return results;
	},
	ask: async () => reply,
});
const cubs = { kind: "device", code: "cubs", platform: "android", iso: null } as const;
/** A chat completion whose answer is `content`. */
const completion = (content: string) => ({ choices: [{ message: { role: "assistant", content } }] });

describe("nameCode", () => {
	it("takes the name a search result gives, with that result as evidence", async () => {
		const reply = completion(JSON.stringify({ name: " Pixel 11 ", url: "https://example.com/pixel-11" }));
		expect(await nameCode(labeller(reply), cubs)).toEqual({
			value: "Pixel 11",
			evidence: "https://example.com/pixel-11",
		});
	});

	it("names nothing on a URL the search did not return, or when the model finds no name", async () => {
		expect(
			await nameCode(
				labeller(completion(JSON.stringify({ name: "Pixel 11", url: "https://elsewhere.example/" }))),
				cubs,
			),
		).toBeNull();
		expect(await nameCode(labeller(completion(JSON.stringify({ name: null, url: null }))), cubs)).toBeNull();
		expect(await nameCode(labeller(completion("{}"), { items: [] }), cubs)).toBeNull();
	});

	it("names nothing the cited result does not itself say, beside the code", async () => {
		const reply = completion(JSON.stringify({ name: "Pixel 11 Pro", url: "https://example.com/pixel-11" }));
		expect(await nameCode(labeller(reply), cubs)).toBeNull();
		const named = completion(JSON.stringify({ name: "Pixel 11", url: "https://example.com/pixel-11" }));
		expect(await nameCode(labeller(named), { ...cubs, code: "tegu" })).toBeNull();
	});

	it("searches for a carrier Android names by SIM rule by its network and selector", async () => {
		const queries: string[] = [];
		const none = completion(JSON.stringify({ name: null, url: null }));
		for (const code of ["37002", "311140SPN=SPROCKET", "20810GID1=4C"])
			await nameCode(labeller(none, RESULTS, queries), {
				kind: "carrier",
				code,
				platform: "android",
				iso: null,
			});
		expect(queries).toEqual([
			"MCC 370 MNC 02 mobile network operator",
			'"SPROCKET" mobile carrier MCC 311 MNC 140',
			"MCC 208 MNC 10 GID1 4C MVNO",
		]);
	});

	it("takes a name only from the line of a list that writes the code", async () => {
		const list = {
			items: [
				{ url: "https://example.com/plmn", title: "Codes", description: "202 09 Wind\n202 10 Vodafone" },
			],
		};
		const carrier = { kind: "carrier", code: "20210", platform: "android", iso: "gr" } as const;
		const answer = (name: string) => completion(JSON.stringify({ name, url: "https://example.com/plmn" }));
		expect(await nameCode(labeller(answer("Wind"), list), carrier)).toBeNull();
		expect(await nameCode(labeller(answer("Vodafone"), list), carrier)).toEqual({
			value: "Vodafone",
			evidence: "https://example.com/plmn",
		});
	});

	it("refuses a reply that is not a completion of the answer's shape", async () => {
		await expect(nameCode(labeller(completion("not json")), cubs)).rejects.toThrow();
	});
});
