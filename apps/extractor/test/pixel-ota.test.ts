import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { updateConfig, updateFiles, updateRequest } from "../src/pixel/update-service.ts";

/** Google's answer for rango on CP3A. */
const ANSWER = new Uint8Array(readFileSync(new URL("./fixtures/pixel-ota-rango-cp3a.bin", import.meta.url)));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

describe("the update service", () => {
	it("asks as adevtool's request.proto encodes it: the bytes that got a 200 for rango on CP3A", () => {
		expect(hex(updateRequest("rango", "CP3A"))).toBe(
			"0a4222400804123c18242a0572616e676f320443503341420572616e676f4a0572616e676f5a02656e620255536a06476f6f676c657206676f6f676c657a0572616e676f121e0a1c0a1a636f6d2e676f6f676c652e616e64726f69642e63617272696572",
		);
	});

	it("reads the update_config flag and the files it lists, on ssl.gstatic.com", () => {
		const config = updateConfig(ANSWER);
		expect(config.get("carrier_settings_url")).toBe(
			"https://ssl.gstatic.com/paris/y26q3/pixel2025-%2$s-%3$d.pb",
		);
		expect(updateFiles(config, "rango")).toEqual([
			{
				name: "carrier_list",
				version: "79000000591",
				url: "https://ssl.gstatic.com/paris/y26q3/carrier_list-79000000591.pb",
			},
			{
				name: "dish5gsa_us",
				version: "79000000015",
				url: "https://ssl.gstatic.com/paris/y26q3/pixel2025-dish5gsa_us-79000000015.pb",
			},
			{
				name: "rogers5g_ca",
				version: "79000000015",
				url: "https://ssl.gstatic.com/paris/y26q3/pixel2025-rogers5g_ca-79000000015.pb",
			},
			{
				name: "rogers_ca",
				version: "79000000017",
				url: "https://ssl.gstatic.com/paris/y26q3/pixel2025-rogers_ca-79000000017.pb",
			},
		]);
	});

	it("lists nothing when the answer has no update_config, and refuses a file off gstatic", () => {
		expect(updateFiles(new Map([["is_pixel", "prod"]]), "rango")).toEqual([]);
		expect(() =>
			updateFiles(
				new Map([
					["carrier_settings_url", "https://evil.example/%2$s-%3$d.pb"],
					["x_us", "1"],
				]),
				"rango",
			),
		).toThrow(/not on/);
	});

	it("fills an older train's positional template with the Pixel's product name, as String.format does", () => {
		const config = new Map([
			["carrier_settings_url", "https://ssl.gstatic.com/paris/sc/%s-%s-%d.pb"],
			["tmobile_us", "32000000010"],
		]);
		expect(updateFiles(config, "oriole")).toEqual([
			{
				name: "tmobile_us",
				version: "32000000010",
				url: "https://ssl.gstatic.com/paris/sc/oriole-tmobile_us-32000000010.pb",
			},
		]);
	});
});
