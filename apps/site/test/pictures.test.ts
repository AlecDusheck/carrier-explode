import { describe, expect, it } from "vitest";
import { pictureOf } from "../src/lib/server/pictures.ts";

const carrier = (carrierName: string, carrierLogo: string | null = null) =>
	({ carrierName, carrierLogo, cc: "us" }) as const;

describe("pictureOf", () => {
	it("pictures every source of a carrier by the logo its name names", () => {
		expect(pictureOf({ platform: "ios", kind: "carrier", name: "ATT_US" }, carrier("AT&T"))).toEqual({
			kind: "logo",
			slug: "att",
		});
		expect(pictureOf({ platform: "android", kind: "carrier", name: "att_us" }, carrier("AT&T"))).toEqual({
			kind: "logo",
			slug: "att",
		});
	});

	it("takes a logo label over the name, and pictures a name with neither by its initials", () => {
		expect(
			pictureOf({ platform: "ios", kind: "carrier", name: "Hutchison_uk" }, carrier("3", "three")),
		).toEqual({ kind: "logo", slug: "three" });
		expect(pictureOf({ platform: "ios", kind: "carrier", name: "Hutchison_uk" }, carrier("3"))).toEqual({
			kind: "initials",
			brand: "3",
		});
	});

	it("refuses a logo label that names no file", () => {
		expect(() =>
			pictureOf({ platform: "ios", kind: "carrier", name: "ATT_US" }, carrier("AT&T", "no-such-logo")),
		).toThrow();
	});

	it("pictures a country bundle by its flag, and a source no carrier links by its name", () => {
		const unlinked = { carrierName: null, carrierLogo: null, cc: "us" } as const;
		expect(pictureOf({ platform: "ios", kind: "country", name: "UnitedStates" }, unlinked)).toEqual({
			kind: "flag",
			cc: "us",
		});
		expect(pictureOf({ platform: "ios", kind: "carrier", name: "New_xx" }, unlinked)).toEqual({
			kind: "initials",
			brand: "New_xx",
		});
	});
});

describe("carrier logo labels", () => {
	it("name a file in static/carriers", async () => {
		const { readdir, readFile } = await import("node:fs/promises");
		const { isLogoSlug } = await import("../src/lib/carrierlogos.ts");
		const dir = new URL("../../../packages/db/migrations/", import.meta.url);
		const sql = await Promise.all(
			(await readdir(dir)).map((m) => readFile(new URL(`${m}/migration.sql`, dir), "utf8")),
		);
		const logos = sql.flatMap((s) =>
			[...s.matchAll(/\('carrier', '[^']+', 'logo', '([^']+)'/g)].map((m) => m[1] ?? ""),
		);
		expect(logos.length).toBeGreaterThan(0);
		expect(logos.filter((l) => !isLogoSlug(l))).toEqual([]);
	});
});
