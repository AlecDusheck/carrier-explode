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
const labeller = (reply: unknown, results: unknown = RESULTS): Labeller => ({
	search: async () => results,
	ask: async () => reply,
});
/** A chat completion whose answer is `content`. */
const completion = (content: string) => ({ choices: [{ message: { role: "assistant", content } }] });

describe("nameCode", () => {
	it("takes the name a search result gives, with that result as evidence", async () => {
		const reply = completion(JSON.stringify({ name: " Pixel 11 ", url: "https://example.com/pixel-11" }));
		expect(await nameCode(labeller(reply), "device", "cubs")).toEqual({
			value: "Pixel 11",
			evidence: "https://example.com/pixel-11",
		});
	});

	it("names nothing on a URL the search did not return, or when the model finds no name", async () => {
		expect(
			await nameCode(
				labeller(completion(JSON.stringify({ name: "Pixel 11", url: "https://elsewhere.example/" }))),
				"device",
				"cubs",
			),
		).toBeNull();
		expect(
			await nameCode(labeller(completion(JSON.stringify({ name: null, url: null }))), "device", "cubs"),
		).toBeNull();
		expect(await nameCode(labeller(completion("{}"), { items: [] }), "device", "cubs")).toBeNull();
	});

	it("refuses a reply that is not a completion of the answer's shape", async () => {
		await expect(nameCode(labeller(completion("not json")), "device", "cubs")).rejects.toThrow();
	});
});
