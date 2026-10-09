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

const page = (description: string, title = "Codes") => ({
	items: [{ url: "https://example.com/plmn", title, description }],
});
/** What `nameCode` makes of a model naming `code` `name` from `results`. */
const nameFrom = async (
	code: string,
	name: string,
	results: unknown,
	kind: "carrier" | "modemFamily" = "carrier",
) =>
	nameCode(labeller(completion(JSON.stringify({ name, url: "https://example.com/plmn" })), results), {
		kind,
		code,
		platform: kind === "carrier" ? "android" : "ios",
		iso: null,
	});

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

	describe("finds the name in the code's record", () => {
		it("with an MNC written without its leading zero", async () => {
			const row = page("284 | 3 | bg | Bulgaria | 359 | Vivacom\n284 | 5 | bg | Bulgaria | 359 | Yettel");
			expect(await nameFrom("28405", "Yettel", row)).not.toBeNull();
			expect(await nameFrom("28405", "Vivacom", row)).toBeNull();
			const title = page("Sweden", "MCC 240 MNC 17 - Götalandsnätet AB (Gotanet) in Sweden");
			expect(await nameFrom("240017", "Götalandsnätet AB", title)).not.toBeNull();
		});

		it("with its cells on separate lines, never the next or previous row's", async () => {
			const czech = page("230\n02\ncz\nCzech Republic\n420\nO2\n230\n03\ncz\nCzech Republic\n420\nVodafone");
			expect(await nameFrom("23003", "Vodafone", czech)).not.toBeNull();
			expect(await nameFrom("23003", "O2", czech)).toBeNull();
			const bosnia = page("218\n03\nHT-ERONET\nOperational\n218\n05\nm:tel\nOperational\n218\n90\nBH Mobile");
			expect(await nameFrom("21803", "HT-ERONET", bosnia)).not.toBeNull();
			expect(await nameFrom("21805", "m:tel", bosnia)).not.toBeNull();
			expect(await nameFrom("21890", "BH Mobile", bosnia)).not.toBeNull();
			expect(await nameFrom("21805", "HT-ERONET", bosnia)).toBeNull();
			expect(await nameFrom("21890", "m:tel", bosnia)).toBeNull();
			const greece = page("202\n09\nWind\n202\n10\nNOVA");
			expect(await nameFrom("20210", "NOVA", greece)).not.toBeNull();
			expect(await nameFrom("20210", "Wind", greece)).toBeNull();
			const families = page("Mav22\nQualcomm X65\nMav23\nQualcomm X70");
			expect(await nameFrom("Mav23", "Qualcomm X70", families, "modemFamily")).not.toBeNull();
			expect(await nameFrom("Mav23", "Qualcomm X65", families, "modemFamily")).toBeNull();
		});

		it("far along a long row", async () => {
			const row = page(
				"260 | 03 | pl | Poland | 48 | Polska Telefonia Komórkowa Centertel Sp. z o.o. | Orange",
			);
			expect(await nameFrom("26003", "Orange", row)).not.toBeNull();
		});

		it("whichever quotes the page and the reply use", async () => {
			const spn = page("MCC 234 MNC 15 SPN SAINSBURY’S: Sainsbury’s Mobile");
			expect(await nameFrom("23415SPN=SAINSBURY'S", "Sainsbury's Mobile", spn)).not.toBeNull();
		});

		it("for a MediaTek SBP id, only on a page about MediaTek or SBP", async () => {
			const sbp = { kind: "modemConfig", code: "SBP 348", platform: "android", iso: null } as const;
			const answer = completion(JSON.stringify({ name: "T-Mobile", url: "https://example.com/plmn" }));
			const operators = page("347 Sprint\n348 T-Mobile\n349 Verizon", "Operator IDs");
			expect(await nameCode(labeller(answer, operators), sbp)).toBeNull();
			const mediatek = page("347 Sprint\n348 T-Mobile\n349 Verizon", "MediaTek SBP IDs");
			expect(await nameCode(labeller(answer, mediatek), sbp)).not.toBeNull();
		});
	});

	it("searches for a Galaxy modem configuration as Qualcomm's", async () => {
		const queries: string[] = [];
		const none = completion(JSON.stringify({ name: null, url: null }));
		await nameCode(labeller(none, RESULTS, queries), {
			kind: "modemConfig",
			code: "CTC",
			platform: "samsung",
			iso: null,
		});
		expect(queries).toEqual(['Galaxy Qualcomm MCFG carrier configuration "CTC"']);
	});

	it("refuses a reply that is not a completion of the answer's shape", async () => {
		await expect(nameCode(labeller(completion("not json")), cubs)).rejects.toThrow();
	});
});
