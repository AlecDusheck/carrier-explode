/**
 * Consumer features a carrier turns on through its bundle, decided from the settings a phone
 * actually gets: carrier.plist with that phone's override plist on top. Each answer names the
 * keys it read, so the page can show why. Features the bundle cannot switch off (Personal
 * Hotspot works without any bundle key on most carriers) are left out rather than guessed.
 *
 * Feature names follow Apple's own list (support.apple.com/109526) where it has one.
 */

import { isJsonDict, mergeSettings } from "#lib/decode/plist.ts";
import { FEATURE_SLUGS, type FeatureSlug } from "../params.ts";

/** on: available and on by default. available: a switch in Settings, or the carrier's server decides per plan. no: not offered. */
export type FeatureState = "on" | "available" | "no";

export interface Feature {
  slug: FeatureSlug;
  name: string;
  /** One sentence a non-expert understands. */
  what: string;
  /** Where the switch lives, when there is one. */
  where?: string;
  /** The keys it is decided by, for the "why" link. */
  keys: string[];
  /** Needs a 5G modem: a carrier can switch it on for every phone, but an LTE-only iPhone cannot use it. */
  needs5G?: true;
  decide: (e: Settings) => { state: FeatureState; because: string[] };
}

type Settings = Record<string, unknown>;

const dict = (v: unknown) => (isJsonDict(v) ? v : undefined);
const at = (e: Settings, path: string): unknown =>
  path.split(".").reduce<unknown>((v, k) => dict(v)?.[k], e);
const yes = (e: Settings, path: string) => at(e, path) === true;

/** Entitlement classes the phone may ask the carrier's server about (fields.ts ENTITLEMENT_CLASSES). */
function entitled(e: Settings, bit: number): boolean {
  const v = at(e, "CarrierEntitlements.SupportedEntitlements");
  return typeof v === "number" && Math.floor(v / 2 ** bit) % 2 === 1;
}

type Rule = [FeatureState, string, (e: Settings) => boolean];

const first = (r: Rule[], e: Settings) => r.find(([, , test]) => test(e));

/**
 * The first rule that holds decides. When none does for the bundle's own settings but one does
 * with an MVNOOverrides configuration on top, the feature depends on the SIM: available.
 * None holding either way means not offered.
 */
function rules(...r: Rule[]) {
  return (e: Settings) => {
    const hit = first(r, e);
    if (hit) return { state: hit[0], because: [hit[1]] };
    for (const [name, c] of Object.entries(dict(e.MVNOOverrides) ?? {})) {
      const conf = dict(dict(c)?.OverrideConfiguration);
      const sim = conf && first(r, mergeSettings(e, conf));
      if (sim && sim[0] !== "no") return { state: "available" as const, because: [`MVNOOverrides.${name}.OverrideConfiguration.${sim[1]}`] };
    }
    return { state: "no" as const, because: [] };
  };
}

const DEFINITIONS: Record<FeatureSlug, Omit<Feature, "slug">> = {
  "5g": {
    needs5G: true,
    name: "5G",
    what: "Your iPhone can use your carrier's 5G network instead of LTE.",
    where: "Settings › Cellular › Cellular Data Options › Voice & Data",
    keys: ["Enable5GAutoByDefault", "Show5GSwitch", "Enable5GStandaloneByDefault", "Show5GStandaloneSwitch", "DataIndicatorOverrideForNRMmwave"],
    decide: rules(
      ["on", "Enable5GAutoByDefault", (e) => yes(e, "Enable5GAutoByDefault")],
      // 5G Standalone is 5G: some bundles set only its keys.
      ["on", "Enable5GStandaloneByDefault", (e) => yes(e, "Enable5GStandaloneByDefault")],
      ["available", "Show5GSwitch", (e) => yes(e, "Show5GSwitch")],
      ["available", "Show5GStandaloneSwitch", (e) => yes(e, "Show5GStandaloneSwitch")],
      ["available", "Supports5GStandalone", (e) => yes(e, "Supports5GStandalone")],
      // The status bar's 5G+ icon is only drawn on a 5G network.
      ["available", "DataIndicatorOverrideForNRMmwave", (e) => typeof e.DataIndicatorOverrideForNRMmwave === "string"],
    ),
  },
  "5g-standalone": {
    needs5G: true,
    name: "5G Standalone",
    what: "5G without an LTE anchor: lower latency and, on some networks, faster speeds and better coverage indoors.",
    where: "Settings › Cellular › Cellular Data Options › Voice & Data › 5G Standalone",
    keys: ["Enable5GStandaloneByDefault", "Show5GStandaloneSwitch", "Supports5GStandalone"],
    decide: rules(
      ["on", "Enable5GStandaloneByDefault", (e) => yes(e, "Enable5GStandaloneByDefault")],
      ["available", "Show5GStandaloneSwitch", (e) => yes(e, "Show5GStandaloneSwitch")],
      ["available", "Supports5GStandalone", (e) => yes(e, "Supports5GStandalone")],
    ),
  },
  "voice-over-5g": {
    needs5G: true,
    name: "Voice over 5G (VoNR)",
    what: "Calls stay on 5G instead of dropping your connection to LTE while you talk.",
    where: "Settings › Cellular › Cellular Data Options › Voice & Data › Voice over 5G",
    keys: ["IMSConfig.Voice.EnableVoNRByDefault", "SupportsVoNR", "ShowVoNRSwitch"],
    decide: rules(
      ["on", "IMSConfig.Voice.EnableVoNRByDefault", (e) => yes(e, "IMSConfig.Voice.EnableVoNRByDefault")],
      ["available", "ShowVoNRSwitch", (e) => yes(e, "ShowVoNRSwitch")],
      ["available", "SupportsVoNR", (e) => yes(e, "SupportsVoNR")],
    ),
  },
  "volte": {
    name: "VoLTE",
    what: "HD voice calls over LTE, and data that keeps working during a call.",
    where: "Settings › Cellular › Cellular Data Options › Voice & Data",
    keys: ["IMSConfig.Voice.EnableVolteByDefault", "ShowVolteSwitch", "CarrierEntitlements.SupportedEntitlements"],
    decide: rules(
      ["on", "IMSConfig.Voice.EnableVolteByDefault", (e) => yes(e, "IMSConfig.Voice.EnableVolteByDefault")],
      ["available", "ShowVolteSwitch", (e) => yes(e, "ShowVolteSwitch")],
      ["available", "CarrierEntitlements.SupportedEntitlements", (e) => entitled(e, 6)],
    ),
  },
  "hd-voice-plus": {
    name: "HD Voice+ (EVS)",
    what: "Clearer calls with the EVS codec, which carries a wider range of your voice than standard HD Voice.",
    keys: ["IMSConfig.Media.AudioCodecs"],
    decide: rules(["on", "IMSConfig.Media.AudioCodecs", (e) =>
      Object.values(dict(at(e, "IMSConfig.Media.AudioCodecs")) ?? {}).some((c) => dict(c)?.EncodingName === "EVS")]),
  },
  "wifi-calling": {
    name: "Wi-Fi Calling",
    what: "Calls and texts over Wi-Fi when cellular coverage is poor.",
    keys: ["IMSConfig.EnableWiFiCallingByDefault", "CarrierEntitlements.SupportedEntitlements", "IMSConfig.EnableWiFiCallingWithoutEntitlement"],
    decide: rules(
      ["on", "IMSConfig.EnableWiFiCallingByDefault", (e) => yes(e, "IMSConfig.EnableWiFiCallingByDefault")],
      ["available", "CarrierEntitlements.SupportedEntitlements", (e) => entitled(e, 7)],
      ["available", "IMSConfig.EnableWiFiCallingWithoutEntitlement", (e) => yes(e, "IMSConfig.EnableWiFiCallingWithoutEntitlement")],
    ),
  },
  "calls-on-other-devices": {
    name: "Wi-Fi Calling on other devices",
    what: "Make and answer your iPhone's calls on your iPad, Mac or Apple Watch, even when the iPhone is not nearby.",
    keys: ["CarrierEntitlements.SupportedEntitlements"],
    decide: rules(["available", "CarrierEntitlements.SupportedEntitlements", (e) => entitled(e, 8)]),
  },
  "rcs": {
    name: "RCS messaging",
    what: "Typing indicators, read receipts, high-quality photos and group chats with Android phones in Messages.",
    where: "Settings › Apps › Messages › RCS Messaging",
    keys: ["RCS.EnableRCSByDefault", "RCS.ShowRCSSwitch", "RCS.ProvisioningData"],
    decide: rules(
      ["on", "RCS.EnableRCSByDefault", (e) => yes(e, "RCS.EnableRCSByDefault")],
      ["available", "RCS.ShowRCSSwitch", (e) => yes(e, "RCS.ShowRCSSwitch")],
      ["available", "RCS.ProvisioningData", (e) => !!dict(at(e, "RCS.ProvisioningData"))],
      ["available", "CarrierEntitlements.SupportedEntitlements", (e) => entitled(e, 22)],
    ),
  },
  "rcs-business-messaging": {
    name: "RCS business messaging",
    what: "Verified businesses can message you in Messages with branding, buttons and rich cards.",
    keys: ["RCS.EnableBusinessMessagingByDefault", "RCS.ShowBusinessMessagingSwitch"],
    decide: rules(
      ["on", "RCS.EnableBusinessMessagingByDefault", (e) => yes(e, "RCS.EnableBusinessMessagingByDefault")],
      ["available", "RCS.ShowBusinessMessagingSwitch", (e) => yes(e, "RCS.ShowBusinessMessagingSwitch")],
    ),
  },
  "satellite": {
    name: "Carrier satellite features",
    what: "Texting through satellites when there is no cell signal, provided by your carrier rather than by Apple.",
    keys: ["EnableSatelliteByDefault", "SupportsSatellite", "ShowSatelliteSwitch", "CarrierEntitlements.SupportedEntitlements"],
    decide: rules(
      ["on", "EnableSatelliteByDefault", (e) => yes(e, "EnableSatelliteByDefault")],
      ["available", "SupportsSatellite", (e) => yes(e, "SupportsSatellite")],
      ["available", "ShowSatelliteSwitch", (e) => yes(e, "ShowSatelliteSwitch")],
      ["available", "CarrierEntitlements.SupportedEntitlements", (e) => entitled(e, 19)],
    ),
  },
  "visual-voicemail": {
    name: "Visual Voicemail",
    what: "See and play voicemails in the Phone app without calling your mailbox.",
    keys: ["VisualVoicemailServiceName", "com.apple.voicemail.imap"],
    decide: rules(
      // 391 bundles say "none", which turns it off.
      ["on", "VisualVoicemailServiceName", (e) => typeof e.VisualVoicemailServiceName === "string" && e.VisualVoicemailServiceName.toLowerCase() !== "none"],
      ["on", "com.apple.voicemail.imap", (e) => e.VisualVoicemailServiceName === undefined && !!dict(e["com.apple.voicemail.imap"])],
    ),
  },
  "esim-transfer": {
    name: "eSIM Quick Transfer",
    what: "Move your number to a new iPhone, or from a physical SIM to an eSIM, on the phone without calling your carrier.",
    keys: ["PhoneAccountTransfer", "CarrierEntitlements.SupportPhysicalSIMtoESIMTransfer", "CarrierEntitlements.SupportedEntitlements"],
    decide: rules(
      ["available", "PhoneAccountTransfer", (e) => !!dict(e.PhoneAccountTransfer)],
      ["available", "CarrierEntitlements.SupportPhysicalSIMtoESIMTransfer", (e) => yes(e, "CarrierEntitlements.SupportPhysicalSIMtoESIMTransfer")],
      ["available", "CarrierEntitlements.SupportedEntitlements", (e) => entitled(e, 13)],
    ),
  },
  "esim-from-android": {
    name: "eSIM transfer from Android",
    what: "Move your eSIM from an Android phone to an iPhone during setup, without a new QR code from your carrier.",
    keys: ["CarrierEntitlements.SupportCrossPlatformSIMTransfer"],
    decide: rules(["available", "CarrierEntitlements.SupportCrossPlatformSIMTransfer", (e) => yes(e, "CarrierEntitlements.SupportCrossPlatformSIMTransfer")]),
  },
  "apple-watch-number-sharing": {
    name: "Apple Watch cellular (number sharing)",
    what: "A cellular Apple Watch can use your iPhone's phone number for calls and texts without the iPhone nearby.",
    keys: ["CarrierEntitlements.SupportedEntitlements"],
    decide: rules(["available", "CarrierEntitlements.SupportedEntitlements", (e) => entitled(e, 10)]),
  },
  "branded-calling": {
    name: "Business caller ID",
    what: "Calls from verified businesses show their name and logo instead of just a number.",
    keys: ["IMSConfig.EnableBrandedCallingByDefault", "IMSConfig.ShowBrandedCallingSwitch", "IMSConfig.Signaling.EnableBrandedCallingByDefault", "IMSConfig.Signaling.ShowBrandedCallingSwitch"],
    decide: rules(
      ["on", "IMSConfig.EnableBrandedCallingByDefault", (e) => yes(e, "IMSConfig.EnableBrandedCallingByDefault")],
      ["on", "IMSConfig.Signaling.EnableBrandedCallingByDefault", (e) => yes(e, "IMSConfig.Signaling.EnableBrandedCallingByDefault")],
      ["available", "IMSConfig.ShowBrandedCallingSwitch", (e) => yes(e, "IMSConfig.ShowBrandedCallingSwitch")],
      ["available", "IMSConfig.Signaling.ShowBrandedCallingSwitch", (e) => yes(e, "IMSConfig.Signaling.ShowBrandedCallingSwitch")],
    ),
  },
  "spam-call-warnings": {
    name: "Carrier spam call warnings",
    what: "Your carrier marks likely spam calls on the incoming call screen, before you answer.",
    keys: ["IMSConfig.Signaling.SpamHeaderFeatureCapability"],
    decide: rules(["on", "IMSConfig.Signaling.SpamHeaderFeatureCapability", (e) => at(e, "IMSConfig.Signaling.SpamHeaderFeatureCapability") === "Enabled"]),
  },
};

/** In FEATURE_SLUGS order, which is also the order of the index codes. */
export const FEATURES: Feature[] = FEATURE_SLUGS.map((slug) => ({ slug, ...DEFINITIONS[slug] }));

export const featureBySlug = (slug: string) => FEATURES.find((f) => f.slug === slug);

/** One letter per feature, in FEATURES order; the index file lists that order beside the codes. */
const CODE: Record<FeatureState, string> = { on: "o", available: "a", no: "n" };
const STATE: Record<string, FeatureState> = { o: "on", a: "available", n: "no" };

export const encodeFeatures = (e: Settings) => FEATURES.map((f) => CODE[f.decide(e).state]).join("");

/** A feature's state in a code written with the feature order `slugs` (the index's own list). */
export function decodeFeature(code: string, slugs: string[], slug: string): FeatureState | undefined {
  const i = slugs.indexOf(slug);
  return i < 0 ? undefined : STATE[code[i]];
}
