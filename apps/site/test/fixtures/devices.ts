/** Device records for the fixtures' phones, as the feeds write them: AppleDB's main.json and Google's OTA page (October 2026), read by the feeds' parsers. */

import { boardProducts, boardRefs, type Device, type Label } from "@carrier-explode/schema";
import type { WithPhones } from "../../src/lib/apple/phones.ts";

const DEVICES: readonly Device[] = [
	{ code: "iPhone13,1", family: "apple", released: "2020-11-13", boards: ["D52gAP"] },
	{ code: "iPhone13,2", family: "apple", released: "2020-10-23", boards: ["D53gAP"] },
	{ code: "iPhone15,4", family: "apple", released: "2023-09-22", boards: ["D37AP"] },
	{ code: "iPhone15,5", family: "apple", released: "2023-09-22", boards: ["D38AP"] },
	{ code: "iPhone16,1", family: "apple", released: "2023-09-22", boards: ["D83AP"] },
	{ code: "iPhone16,2", family: "apple", released: "2023-09-22", boards: ["D84AP"] },
	{ code: "iPhone17,1", family: "apple", released: "2024-09-20", boards: ["D93AP"] },
	{ code: "iPhone17,2", family: "apple", released: "2024-09-20", boards: ["D94AP"] },
	{ code: "iPhone17,3", family: "apple", released: "2024-09-20", boards: ["D47AP"] },
	{ code: "iPhone17,4", family: "apple", released: "2024-09-20", boards: ["D48AP"] },
	{ code: "iPhone18,1", family: "apple", released: "2025-09-19", boards: ["V53AP"] },
	{ code: "iPhone18,2", family: "apple", released: "2025-09-19", boards: ["V54AP"] },
	{ code: "iPhone18,3", family: "apple", released: "2025-09-19", boards: ["V57AP"] },
	{ code: "iPhone18,4", family: "apple", released: "2025-09-19", boards: ["D23AP"] },
	{ code: "iPhone19,2", family: "apple", released: "2026-09-18", boards: ["V63AP"] },
	{ code: "iPhone19,3", family: "apple", released: "2026-09-18", boards: ["V64AP"] },
	{ code: "iPhone19,4", family: "apple", released: "2026-10-23", boards: ["V68AP"] },
	{ code: "iPhone19,7", family: "apple", released: "2026-09-18", boards: ["V64sAP"] },
	{ code: "cubs", family: "android", released: "2026-08", boards: [] },
	{ code: "frankel", family: "android", released: "2025-08", boards: [] },
	{ code: "caiman", family: "android", released: "2024-08", boards: [] },
	{ code: "tokay", family: "android", released: "2024-08", boards: [] },
	{ code: "redfin", family: "android", released: "2020-10", boards: [] },
];

const PRODUCTS = boardProducts(DEVICES);

/** Their names as the feeds label them: ipsw.me's /devices (iPhone19,4 has none there) and the OTA page's headings, October 2026. */
const NAMES: ReadonlyArray<readonly [string, string, string]> = [
	["https://api.ipsw.me/v4/devices", "iPhone13,1", "iPhone 12 mini"],
	["https://api.ipsw.me/v4/devices", "iPhone13,2", "iPhone 12"],
	["https://api.ipsw.me/v4/devices", "iPhone15,4", "iPhone 15"],
	["https://api.ipsw.me/v4/devices", "iPhone15,5", "iPhone 15 Plus"],
	["https://api.ipsw.me/v4/devices", "iPhone16,1", "iPhone 15 Pro"],
	["https://api.ipsw.me/v4/devices", "iPhone16,2", "iPhone 15 Pro Max"],
	["https://api.ipsw.me/v4/devices", "iPhone17,1", "iPhone 16 Pro"],
	["https://api.ipsw.me/v4/devices", "iPhone17,2", "iPhone 16 Pro Max"],
	["https://api.ipsw.me/v4/devices", "iPhone17,3", "iPhone 16"],
	["https://api.ipsw.me/v4/devices", "iPhone17,4", "iPhone 16 Plus"],
	["https://api.ipsw.me/v4/devices", "iPhone18,1", "iPhone 17 Pro"],
	["https://api.ipsw.me/v4/devices", "iPhone18,2", "iPhone 17 Pro Max"],
	["https://api.ipsw.me/v4/devices", "iPhone18,3", "iPhone 17"],
	["https://api.ipsw.me/v4/devices", "iPhone18,4", "iPhone Air"],
	["https://api.ipsw.me/v4/devices", "iPhone19,2", "iPhone 18 Pro"],
	["https://api.ipsw.me/v4/devices", "iPhone19,3", "iPhone 18 Pro Max (U.S.)"],
	["https://api.ipsw.me/v4/devices", "iPhone19,7", "iPhone 18 Pro Max"],
	["https://developers.google.com/android/ota", "cubs", "Pixel 11"],
	["https://developers.google.com/android/ota", "frankel", "Pixel 10"],
	["https://developers.google.com/android/ota", "caiman", "Pixel 9 Pro"],
	["https://developers.google.com/android/ota", "tokay", "Pixel 9"],
	["https://developers.google.com/android/ota", "redfin", "Pixel 5"],
];

const DEVICE_LABELS: readonly Label[] = NAMES.map(([evidence, code, value]) => ({
	subject: "device",
	code,
	field: "name",
	value,
	origin: "feed",
	evidence,
}));

const nameOf = new Map(DEVICE_LABELS.map((l) => [l.code, l.value]));

/** A bundle file with the phones its boards are, named, as the server gives it to pages. */
export const withPhones = <F extends { readonly boards?: readonly string[] }>(file: F): WithPhones<F> =>
	file.boards === undefined
		? file
		: {
				...file,
				devices: boardRefs(file.boards, PRODUCTS).map(({ board, product }) =>
					product === undefined
						? { board, name: board }
						: { board, product, name: nameOf.get(product) ?? product },
				),
			};
