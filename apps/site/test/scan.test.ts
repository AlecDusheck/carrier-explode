import { describe, it, expect } from "vitest";
import type { ScannedSource } from "@carrier-explode/db";
import type { SourceKey } from "@carrier-explode/schema/types";
import type { ListEntry } from "../src/lib/server/lists.ts";
import { tally } from "../src/lib/server/scan.ts";

const entry = (name: string, brand: string): ListEntry => ({
	key: `ios:carrier:${name}`,
	platform: "ios",
	path: `/ios/carriers/${name}`,
	name,
	brand,
	picture: { kind: "flag", cc: "us" },
	cc: "us",
	updated: null,
	ruleOnly: false,
	tag: null,
});

const scanned = (source: SourceKey, held: ScannedSource["held"], value?: string): ScannedSource => ({
	source,
	version: "1",
	held,
	leaves: value === undefined ? [] : [{ key: "k", value }],
});

describe("a key scanned across sources", () => {
	it("carries each source's chip, so no chip looks its source up again", () => {
		const sources = [entry("TMobile_US", "T-Mobile"), entry("ATT_US", "AT&T")];
		const r = tally({ path: "MaxDataRate", file: "carrier.plist", scope: "carriers" }, sources, [
			scanned("ios:carrier:TMobile_US", "own", "5"),
			scanned("ios:carrier:ATT_US", "absent"),
		]);
		expect(r.hits.map((h) => [h.source.key, h.source.brand, h.source.path])).toEqual([
			["ios:carrier:TMobile_US", "T-Mobile", "/ios/carriers/TMobile_US"],
			["ios:carrier:ATT_US", "AT&T", "/ios/carriers/ATT_US"],
		]);
		expect(r.buckets.map((b) => [b.value, b.sources.map((s) => s.brand)])).toEqual([
			[5, ["T-Mobile"]],
			[null, ["AT&T"]],
		]);
	});

	it("buckets a value read from a build's default.pb apart from one a carrier sets", () => {
		const pixel = (name: string): ListEntry => ({
			...entry(name, name),
			key: `android:carrier:${name}`,
			platform: "android",
		});
		const r = tally(
			{ path: "k", file: "config", scope: "carriers" },
			[pixel("a"), pixel("b")],
			[scanned("android:carrier:a", "own", "true"), scanned("android:carrier:b", "default", "true")],
		);
		expect(r.buckets.map((b) => [b.value, b.held, b.count])).toEqual([
			[true, "own", 1],
			[true, "default", 1],
		]);
		expect([r.set, r.defaulted]).toEqual([1, 1]);
	});
});
