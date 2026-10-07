import { describe, expect, it } from "vitest";

import { newestProduct } from "../src/index.ts";

describe("newestProduct", () => {
	it("is the newest product type, by generation then model", () => {
		expect(newestProduct(["iPhone17,1", "iPhone18,1", "iPhone12,1"])).toBe("iPhone18,1");
		expect(newestProduct([])).toBeUndefined();
	});
});
