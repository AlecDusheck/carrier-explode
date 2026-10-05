import { describe, expect, it } from "vitest";
import { deviceOf } from "../src/lib/device.ts";

describe("deviceOf", () => {
  it("takes the model Chromium hints", () => {
    expect(deviceOf("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36", "Pixel 9 Pro")).toEqual({ platform: "android", model: "Pixel 9 Pro" });
  });

  it("reads the model from a user agent that still carries it", () => {
    expect(deviceOf("Mozilla/5.0 (Linux; Android 14; Pixel 8a Build/AP2A.240805.005; wv)").model).toBe("Pixel 8a");
    expect(deviceOf("Mozilla/5.0 (Linux; Android 15; Pixel 9)").model).toBe("Pixel 9");
    expect(deviceOf("Mozilla/5.0 (Linux; Android 15; Pixel 9)", "").model).toBe("Pixel 9");
  });

  it("passes Chrome's reduced model through: no Pixel is called K", () => {
    expect(deviceOf("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36")).toEqual({ platform: "android", model: "K" });
  });

  it("tells iPhone and iPad from a desktop", () => {
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)").platform).toBe("ios");
    expect(deviceOf("Mozilla/5.0 (iPad; CPU OS 27_0 like Mac OS X)").platform).toBe("ipados");
    expect(deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)").platform).toBeNull();
  });
});
