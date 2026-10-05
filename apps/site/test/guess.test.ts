import { describe, it, expect } from "vitest";

describe("guessCarrierQuery", () => {
  const list = ["Verizon_LTE_US", "Verizon_Visible_LTE_US", "TMobile_US", "ATT_US", "ATT_FirstNet_US", "Vodafone_de", "EE_uk", "Orange_fr", "BhartiAirtel_in"]
    .map((name) => ({ name, display: name.replace(/_[A-Za-z]{2}$/, "").replace(/_/g, " ") }));
  const cases: Array<[string | undefined, string | null]> = [
    ["Verizon Business", "verizon"],
    ["T-Mobile USA, Inc.", "tmobile"],
    ["AT&T Mobility LLC", "att"],
    ["Vodafone GmbH", "vodafone"],
    ["Orange S.A.", "orange"],
    ["Bharti Airtel Ltd.", "bhartiairtel"],
    ["EE Limited", null],
    ["Comcast Cable Communications", null],
    ["", null],
    [undefined, null],
  ];
  for (const [org, want] of cases) {
    it(`${JSON.stringify(org)} -> ${JSON.stringify(want)}`, async () => {
      const { guessCarrierQuery } = await import("../src/lib/server/guess.ts");
      expect(guessCarrierQuery(org, list)).toBe(want);
    });
  }

  it("names the plainest carrier, the visitor's country first", async () => {
    const { guessCarrierOf } = await import("../src/lib/server/guess.ts");
    const carriers = [
      { name: "AT&T", iso: "us" }, { name: "AT&T FirstNet", iso: "us" }, { name: "Verizon", iso: "us" }, { name: "Verizon Visible", iso: "us" },
      { name: "Vodafone", iso: "gb" }, { name: "Vodafone", iso: "de" },
    ];
    expect(guessCarrierOf("att", carriers, "us")?.name).toBe("AT&T");
    expect(guessCarrierOf("verizon", carriers, "us")?.name).toBe("Verizon");
    expect(guessCarrierOf("vodafone", carriers, "gb")?.iso).toBe("gb");
    expect(guessCarrierOf("vodafone", carriers, "de")?.iso).toBe("de");
    expect(guessCarrierOf("orange", carriers, "fr")).toBeNull();
  });
});
