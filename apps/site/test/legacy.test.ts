import { describe, it, expect } from "vitest";
import { sourceKey } from "@carrier-explode/schema/types";
import { repair, type Held } from "../src/lib/server/legacy.ts";

const SOURCES = new Set([
	"ios:carrier:Softbank_jp",
	"ipados:carrier:Swisscom_ch",
	"watchos:carrier:Telenor_no",
	"ios:country:Jordan",
	"android:carrier:74602",
	"ios:carrier:Vodafone_uk",
]);

const held: Held = {
	source: async (ref) => SOURCES.has(sourceKey(ref)),
	countryFile: async (platform, iso) => (platform === "ios" && iso === "jo" ? "Jordan" : null),
	carriersIn: async (platform, iso) =>
		`${platform}:${iso}` === "android:us" || `${platform}:${iso}` === "samsung:de",
	build: async (id) => id === "23C71",
	article: (path) => path === "ios/der-pri",
};

const at = (path: string, method = "GET"): Request =>
	new Request(`https://carrierexplode.com${path}`, { method });

/** Every route 404s here; `resolved` counts the renders. */
async function run(
	path: string,
	on = true,
	method = "GET",
): Promise<{ readonly response: Response; readonly resolved: number }> {
	let resolved = 0;
	const response = await repair(at(path, method), on, held, async () => {
		resolved++;
		return new Response("not found", { status: 404 });
	});
	return { response, resolved };
}

const location = async (path: string): Promise<string | null> =>
	(await run(path)).response.headers.get("location");

/** No current route starts like these, so they never render. */
const V1: ReadonlyArray<readonly [from: string, to: string]> = [
	["/carriers", "/ios/carriers"],
	["/carriers?q=de", "/ios/carriers?q=de"],
	["/carriers/Softbank_jp", "/ios/carriers/Softbank_jp"],
	["/carriers/Softbank_jp/ios-27.2-beta/changes", "/ios/carriers/Softbank_jp"],
	["/carriers/Swisscom_ch/ota-12.1-iPad/changes", "/ipados/carriers/Swisscom_ch"],
	["/countries", "/ios/countries"],
	["/countries/Jordan/ios-27.0/changes", "/ios/countries/Jordan"],
	["/countries/JO", "/ios/countries/Jordan"],
	["/watch", "/watchos/carriers"],
	["/watch/Telenor_no/ota-28.1/changes", "/watchos/carriers/Telenor_no"],
	["/cell-broadcast", "/ios/countries"],
	["/releases", "/ios/builds"],
	["/baseband/23C71/Mav25", "/ios/builds/23C71"],
	["/builds/23C71/Mav25/carriers", "/ios/builds/23C71"],
	["/wiki/der-pri", "/wiki/ios/der-pri"],
];

/** Current shapes, moved only after they 404: a country by its code for good, a missing version to its source's page as a stand-in. */
const BELOW_SOURCE: ReadonlyArray<readonly [from: string, to: string, status: 301 | 302]> = [
	["/ios/carriers/Softbank_jp/72.7.1/changes", "/ios/carriers/Softbank_jp", 302],
	["/android/carriers/74602/tokay/79000000092/changes", "/android/carriers/74602", 302],
	["/ios/countries/JO", "/ios/countries/Jordan", 301],
	["/android/countries/US", "/android/countries/us", 301],
	["/samsung/countries/DE", "/samsung/countries/de", 301],
];

const STAYS: readonly string[] = [
	"/carriers/Unknown_Carrier/ios-26.4/changes",
	"/watch/Unknown/ota-1.1",
	"/baseband/22A100/Mav25",
	"/wiki/no-such-article",
	"/countries/XX",
	"/ios/countries/US",
	"/android/countries/ZZ",
	// A real country the platform has no carriers in, and a 404 at the very URL a code moves to.
	"/android/countries/FR",
	"/android/countries/us",
	"/wiki/der-pri/x",
	"/raw/carriers/Softbank_jp/ota-61.1/Default.png",
	"/ios/carriers/Unknown/72.0/changes",
	"/ios/carriers/Softbank_jp",
	"/phones/iPhone17,1",
	"/wp-admin/install.php",
	"/carriers/%E0%A4%A",
];

describe("repair", () => {
	for (const [from, to] of V1) {
		it(`${from} -> ${to} without rendering`, async () => {
			const { response, resolved } = await run(from);
			expect([response.status, response.headers.get("location"), resolved]).toEqual([301, to, 0]);
		});
	}
	for (const [from, to, status] of BELOW_SOURCE) {
		it(`${from} -> ${to} (${status}) after a 404`, async () => {
			const { response, resolved } = await run(from);
			expect([response.status, response.headers.get("location"), resolved]).toEqual([status, to, 1]);
		});
	}

	it("finds an iPad file's iOS carrier as a stand-in when iPadOS has none", async () => {
		const { response } = await run("/carriers/Vodafone_uk/ota-12.1-iPad/changes");
		expect([response.status, response.headers.get("location")]).toEqual([302, "/ios/carriers/Vodafone_uk"]);
	});

	it("repairs HEAD as it does GET", async () => {
		const { response, resolved } = await run("/carriers/Softbank_jp", true, "HEAD");
		expect([response.status, response.headers.get("location"), resolved]).toEqual([
			301,
			"/ios/carriers/Softbank_jp",
			0,
		]);
	});
	for (const path of STAYS) it(`${path} stays a 404`, async () => expect(await location(path)).toBeNull());

	it("is a no-op when switched off", async () => {
		const { response, resolved } = await run("/carriers/Softbank_jp", false);
		expect([response.status, resolved]).toEqual([404, 1]);
	});

	it("leaves requests other than GET and HEAD", async () => {
		expect((await run("/carriers/Softbank_jp", true, "POST")).response.status).toBe(404);
	});

	it("leaves a current page that rendered", async () => {
		const ok = new Response("ok");
		expect(await repair(at("/ios/carriers/Softbank_jp/72.7.1"), true, held, async () => ok)).toBe(ok);
		expect(await repair(at("/wiki/credits"), true, held, async () => ok)).toBe(ok);
	});
});
