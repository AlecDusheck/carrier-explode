import { describe, expect, it } from "vitest";
import { VIEWS, tabView } from "../src/lib/components/views.ts";
import AndroidModem from "../src/lib/components/android/Modem.svelte";
import AppleModem from "../src/lib/components/ios/tabs/Modem.svelte";
import AppleChoice from "../src/lib/components/ios/PhoneChoice.svelte";

describe("the Modem tab", () => {
  it("is a versioned tab without a file path on every platform", () => {
    for (const p of ["ios", "ipados", "watchos", "android"] as const) expect(tabView(p, "modem")).toMatchObject({ takesPath: false, versioned: true });
  });

  it("is each platform's own view", () => {
    expect(VIEWS.android.tabs.modem?.body).toBe(AndroidModem);
    expect(VIEWS.ios.tabs.modem?.body).toBe(AppleModem);
  });

  it("offers Apple's phone after the version on the tabs that show one phone's file", () => {
    expect(VIEWS.ios.tabs.settings?.Choice).toBe(AppleChoice);
    expect(VIEWS.ios.tabs.files?.Choice).toBeNull();
    expect(VIEWS.android.tabs.settings?.Choice).toBeNull();
  });

  it("leaves Apple without an APNs tab and Android without alerts", () => {
    expect([tabView("ios", "apns"), tabView("android", "alerts")]).toEqual([undefined, undefined]);
  });
});
