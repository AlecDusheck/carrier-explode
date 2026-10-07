/** The Pixel feed's pure parts: the OTA page and the release days. */

import { describe, expect, it } from "vitest";
import { firstPatches, parseOtaPage, pixelDevices } from "../src/pixel/check.ts";

const row = (device: string, label: string, build: string): string =>
	`<tr id="${device}${build}"><td>${label}</td><td><a href="https://dl.google.com/dl/android/aosp/${device}-ota-${build}-0000.zip">Link</a></td><td>00</td></tr>`;

const PAGE = `
<h2 id="tokay" data-text='"tokay" for Pixel 9' tabindex="-1">"tokay" for Pixel 9</h2>
<table>${row("tokay", "17.0.0 (CP2A.260805.005, Aug 2026)", "cp2a.260805.005")}
${row("tokay", "17.0.0 (CP2A.260805.005.A1, Aug 2026, AT&amp;T)", "cp2a.260805.005.a1")}
${row("tokay", "17.0.0 (CP3A.260905.009, Sep 2026)", "cp3a.260905.009")}</table>
<h2 id="oriole" data-text='"oriole" for Pixel 6' tabindex="-1">"oriole" for Pixel 6</h2>
<table>${row("oriole", "17.0.0 (CP3A.260905.009, Sep 2026)", "cp3a.260905.009")}</table>
<h2 id="sailfish" data-text='"sailfish" for Pixel' tabindex="-1">"sailfish" for Pixel</h2>
<table>${row("sailfish", "9.0.0 (PQ3A.190801.002, Aug 2019)", "pq3a.190801.002")}
${row("sailfish", "10.0.0 (QP1A.191005.007.A3, Dec 2019)", "qp1a.191005.007.a3")}</table>`;

describe("parseOtaPage", () => {
	it("reads devices, builds, months and variants", () => {
		const [tokay] = parseOtaPage(PAGE);
		expect(tokay?.name).toBe("Pixel 9");
		expect(tokay?.builds.map((b) => [b.build, b.patch, b.variant])).toEqual([
			["CP2A.260805.005", "2026-08", undefined],
			["CP2A.260805.005.A1", "2026-08", "AT&T"],
			["CP3A.260905.009", "2026-09", undefined],
		]);
	});

	it("fails loudly on a page without devices", () => {
		expect(() => parseOtaPage("<html>terms</html>")).toThrow(/no devices/);
	});
});

// As source.android.com lays out its build numbers, cut to a few rows; one row's devices split on a full-width comma.
const build = (id: string, devices: string, patch: string): string =>
	`<tr>
<td>${id}</td>
<td>android-x</td>
<td>Android17</td>
<td>${devices}</td>
<td>${patch}</td>
</tr>`;
const BUILD_NUMBERS_PAGE = `<table><tr><th>Codename</th></tr><tr><td>Android17</td><td>17</td></tr></table>
<h2 id="source-code-tags-and-builds" data-text="Source code tags and builds">Source code tags and builds</h2>
<table><thead><tr><th>Build ID</th><th>Tag</th><th>Version</th><th>Supported devices</th><th>Security patch level</th></tr></thead><tbody>
${build("CP3A.260905.009", "Pixel 6, Pixel 9", "2026-09-05")}
${build("15848949", "", "2026-05-05")}
${build("SD1A.210817.019.C4", "Pixel 6，Pixel 6 Pro", "2021-10-05")}
${build("TQ1A.230205.002", "Pixel 9", "2026-08-05")}
<tr><td>Earliest Gingerbread version</td></tr>
</tbody></table>
<h2 id="build-targets">Device codenames</h2><table><tr><td>Pixel 6</td><td>oriole</td></tr></table>`;

describe("Pixel release days", () => {
	it("read each device name's first security patch month from the build numbers", () => {
		expect(firstPatches(BUILD_NUMBERS_PAGE)).toEqual(
			new Map([
				["pixel6", "2021-10"],
				["pixel9", "2026-08"],
				["pixel6pro", "2021-10"],
			]),
		);
		expect(() => firstPatches("<html></html>")).toThrow(/layout changed/);
	});

	it("take the earlier of the OTA page's first build and the build numbers' first patch", () => {
		expect(pixelDevices(parseOtaPage(PAGE), firstPatches(BUILD_NUMBERS_PAGE))).toEqual([
			{ code: "tokay", platform: "android", released: "2026-08", boards: [] },
			// The OTA page dropped oriole's first builds; the build numbers kept them.
			{ code: "oriole", platform: "android", released: "2021-10", boards: [] },
			{ code: "sailfish", platform: "android", released: "2019-08", boards: [] },
		]);
	});
});
