/** Apple feature states, decided from the settings a phone gets. Names follow Apple's own list (support.apple.com/109526). */

import { isJsonDict } from "@carrier-explode/decode-ios";
import type { FeatureSlug } from "../concepts.ts";
import type { FeatureState, NativeRef } from "../types.ts";
import { hasBit, stateReading, type StateReading } from "../values.ts";
import { members, mvnoConfigurations, read, type Settings } from "./settings.ts";

/** The feature has `state` when the value at `path` passes `holds`. */
type Rule = readonly [state: FeatureState, path: string, holds: (value: unknown) => boolean];

export interface AppleFeature {
  /** The first rule that holds decides. */
  readonly rules: readonly Rule[];
  /** Where its switch is in Settings. */
  readonly where?: string;
}

const isTrue = (v: unknown): boolean => v === true;
const on = (path: string, holds = isTrue): Rule => ["on", path, holds];
const available = (path: string, holds = isTrue): Rule => ["available", path, holds];

/** CarrierEntitlements.SupportedEntitlements bits (fields.ts ENTITLEMENT_CLASSES): the carrier's server decides per plan. */
const entitlement = (bit: number): Rule =>
  ["available", "CarrierEntitlements.SupportedEntitlements", (v) => typeof v === "number" && hasBit(v, bit)];

const VOICE_DATA = "Settings › Cellular › Cellular Data Options › Voice & Data";

export const APPLE_FEATURES = {
  "5g": {
    where: VOICE_DATA,
    rules: [
      on("Enable5GAutoByDefault"),
      // Some bundles set only the standalone keys, and 5G Standalone is 5G.
      on("Enable5GStandaloneByDefault"),
      available("Show5GSwitch"),
      available("Show5GStandaloneSwitch"),
      available("Supports5GStandalone"),
      // The status bar's 5G+ icon is only drawn on a 5G network.
      available("DataIndicatorOverrideForNRMmwave", (v) => typeof v === "string"),
    ],
  },
  "5g-standalone": {
    where: `${VOICE_DATA} › 5G Standalone`,
    rules: [on("Enable5GStandaloneByDefault"), available("Show5GStandaloneSwitch"), available("Supports5GStandalone")],
  },
  "voice-over-5g": {
    where: `${VOICE_DATA} › Voice over 5G`,
    rules: [on("IMSConfig.Voice.EnableVoNRByDefault"), available("ShowVoNRSwitch"), available("SupportsVoNR")],
  },
  volte: {
    where: VOICE_DATA,
    rules: [on("IMSConfig.Voice.EnableVolteByDefault"), available("ShowVolteSwitch"), entitlement(6)],
  },
  "hd-voice-plus": {
    rules: [on("IMSConfig.Media.AudioCodecs", (v) => members(v).some((c) => isJsonDict(c) && c.EncodingName === "EVS"))],
  },
  "wifi-calling": {
    rules: [on("IMSConfig.EnableWiFiCallingByDefault"), entitlement(7), available("IMSConfig.EnableWiFiCallingWithoutEntitlement")],
  },
  "calls-on-other-devices": { rules: [entitlement(8)] },
  rcs: {
    where: "Settings › Apps › Messages › RCS Messaging",
    rules: [on("RCS.EnableRCSByDefault"), available("RCS.ShowRCSSwitch"), available("RCS.ProvisioningData", isJsonDict), entitlement(22)],
  },
  "rcs-business-messaging": {
    rules: [on("RCS.EnableBusinessMessagingByDefault"), available("RCS.ShowBusinessMessagingSwitch")],
  },
  satellite: {
    rules: [on("EnableSatelliteByDefault"), available("SupportsSatellite"), available("ShowSatelliteSwitch"), entitlement(19)],
  },
  "visual-voicemail": {
    rules: [
      on("VisualVoicemailServiceName", (v) => typeof v === "string" && v.toLowerCase() !== "none"),
      // Any other service name, "none" included, turns it off whatever the IMAP settings say.
      ["no", "VisualVoicemailServiceName", () => true],
      on("com.apple.voicemail.imap", isJsonDict),
    ],
  },
  "esim-transfer": {
    rules: [available("PhoneAccountTransfer", isJsonDict), available("CarrierEntitlements.SupportPhysicalSIMtoESIMTransfer"), entitlement(13)],
  },
  "esim-from-android": { rules: [available("CarrierEntitlements.SupportCrossPlatformSIMTransfer")] },
  "apple-watch-number-sharing": { rules: [entitlement(10)] },
  "branded-calling": {
    rules: [
      on("IMSConfig.EnableBrandedCallingByDefault"),
      on("IMSConfig.Signaling.EnableBrandedCallingByDefault"),
      available("IMSConfig.ShowBrandedCallingSwitch"),
      available("IMSConfig.Signaling.ShowBrandedCallingSwitch"),
    ],
  },
  "spam-call-warnings": { rules: [on("IMSConfig.Signaling.SpamHeaderFeatureCapability", (v) => v === "Enabled")] },
} as const satisfies Partial<Record<FeatureSlug, AppleFeature>>;

export type AppleFeatureSlug = keyof typeof APPLE_FEATURES;

function firstHolding(rules: readonly Rule[], s: Settings): { readonly state: FeatureState; readonly ref: NativeRef } | undefined {
  for (const [state, path, holds] of rules) {
    const r = read(s, path);
    if (r !== undefined && holds(r.value)) return { state, ref: r.ref };
  }
  return undefined;
}

/** When the bundle's own settings do not offer it but an MVNO configuration's do, it depends on the SIM. A "no" names the keys looked at. */
function decide(f: AppleFeature, s: Settings): StateReading {
  const own = firstHolding(f.rules, s);
  if (own !== undefined && own.state !== "no") return stateReading(own.state, [own.ref]);
  for (const mvno of mvnoConfigurations(s)) {
    const hit = firstHolding(f.rules, mvno.settings);
    if (hit !== undefined && hit.state !== "no") return stateReading("available", [hit.ref]);
  }
  const looked = [...new Set(f.rules.map(([, path]) => path))].flatMap((p) => read(s, p)?.ref ?? []);
  return stateReading("no", own === undefined ? looked : [own.ref]);
}

const isAppleFeatureSlug = (slug: string): slug is AppleFeatureSlug => Object.hasOwn(APPLE_FEATURES, slug);

/** Where a feature's switch is in Settings, for the features Apple's settings decide. */
export function appleFeatureWhere(slug: FeatureSlug): string | undefined {
  if (!isAppleFeatureSlug(slug)) return undefined;
  const feature: AppleFeature = APPLE_FEATURES[slug];
  return feature.where;
}

export function appleFeature(slug: AppleFeatureSlug): (view: { readonly settings: Settings }) => StateReading {
  const feature: AppleFeature = APPLE_FEATURES[slug];
  return ({ settings }) => decide(feature, settings);
}
