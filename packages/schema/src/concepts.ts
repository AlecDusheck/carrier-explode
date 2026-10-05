/** Platform-neutral concept definitions; each platform's readers (ios/readers.ts, android/readers.ts) are typed by them. */

import type { ConceptValue } from "./types.ts";
import type { StateReading, Unset, ValueReading } from "./values.ts";

export const CONCEPT_GROUPS = [
  "features",
  "voice",
  "nr",
  "wifi-calling",
  "messaging",
  "supplementary",
  "emergency",
  "data",
  "tethering",
  "roaming",
  "display",
  "voicemail",
  "satellite",
  "entitlement",
  "signal",
] as const;
export type ConceptGroup = (typeof CONCEPT_GROUPS)[number];

export const GROUP_NAMES = {
  features: "Features",
  voice: "Voice and IMS",
  nr: "5G",
  "wifi-calling": "Wi-Fi Calling",
  messaging: "SMS and MMS",
  supplementary: "Call settings and USSD",
  emergency: "Emergency and alerts",
  data: "Data and APNs",
  tethering: "Tethering",
  roaming: "Roaming",
  display: "Name and icons",
  voicemail: "Voicemail",
  satellite: "Satellite",
  entitlement: "Entitlement",
  signal: "Signal bars",
} as const satisfies Readonly<Record<ConceptGroup, string>>;

type ConceptUnit = "bytes" | "ms" | "s" | "dBm" | "count" | "px" | "chars" | "port";

/** Unordered lists are sorted by readers, so equal sets compare equal. */
type ConceptValueSpec =
  /** needs5G: a phone without a 5G radio cannot use it, whatever the carrier sets. */
  | { readonly type: "state"; readonly needs5G: boolean }
  | { readonly type: "boolean" }
  | { readonly type: "number"; readonly unit: ConceptUnit }
  | { readonly type: "string" }
  | { readonly type: "list"; readonly of: "string" | "number"; readonly ordered: boolean };

type ConceptDef = {
  readonly id: string;
  readonly group: ConceptGroup;
  readonly name: string;
  /** One sentence for a non-expert. */
  readonly description: string;
} & ConceptValueSpec;

const ms = { type: "number", unit: "ms" } as const;
const s = { type: "number", unit: "s" } as const;
const count = { type: "number", unit: "count" } as const;
const bool = { type: "boolean" } as const;
const str = { type: "string" } as const;
const state = { type: "state", needs5G: false } as const;
const state5G = { type: "state", needs5G: true } as const;
const strings = { type: "list", of: "string", ordered: false } as const;
const numbers = { type: "list", of: "number", ordered: false } as const;

/** Registry order is display order. */
const CONCEPTS = [
  { id: "5g", group: "features", name: "5G", description: "Your phone can use your carrier's 5G network instead of LTE.", ...state5G },
  { id: "5g-standalone", group: "features", name: "5G Standalone", description: "5G without an LTE anchor: lower latency and, on some networks, faster speeds and better coverage indoors.", ...state5G },
  { id: "voice-over-5g", group: "features", name: "Voice over 5G (VoNR)", description: "Calls stay on 5G instead of dropping your connection to LTE while you talk.", ...state5G },
  { id: "volte", group: "features", name: "VoLTE", description: "HD voice calls over LTE, and data that keeps working during a call.", ...state },
  { id: "hd-voice-plus", group: "features", name: "HD Voice+ (EVS)", description: "Clearer calls with the EVS codec, which carries a wider range of your voice than standard HD Voice.", ...state },
  { id: "wifi-calling", group: "features", name: "Wi-Fi Calling", description: "Calls and texts over Wi-Fi when cellular coverage is poor.", ...state },
  { id: "calls-on-other-devices", group: "features", name: "Wi-Fi Calling on other devices", description: "Make and answer your iPhone's calls on your iPad, Mac or Apple Watch, even when the iPhone is not nearby.", ...state },
  { id: "rcs", group: "features", name: "RCS messaging", description: "Typing indicators, read receipts, high-quality photos and group chats with Android phones in Messages.", ...state },
  { id: "rcs-business-messaging", group: "features", name: "RCS business messaging", description: "Verified businesses can message you in Messages with branding, buttons and rich cards.", ...state },
  { id: "satellite", group: "features", name: "Carrier satellite features", description: "Texting through satellites when there is no cell signal, provided by your carrier.", ...state },
  { id: "visual-voicemail", group: "features", name: "Visual Voicemail", description: "See and play voicemails in the Phone app without calling your mailbox.", ...state },
  { id: "esim-transfer", group: "features", name: "eSIM Quick Transfer", description: "Move your number to a new iPhone, or from a physical SIM to an eSIM, on the phone without calling your carrier.", ...state },
  { id: "esim-from-android", group: "features", name: "eSIM transfer from Android", description: "Move your eSIM from an Android phone to an iPhone during setup, without a new QR code from your carrier.", ...state },
  { id: "apple-watch-number-sharing", group: "features", name: "Apple Watch cellular (number sharing)", description: "A cellular Apple Watch can use your iPhone's phone number for calls and texts without the iPhone nearby.", ...state },
  { id: "branded-calling", group: "features", name: "Business caller ID", description: "Calls from verified businesses show their name and logo instead of just a number.", ...state },
  { id: "spam-call-warnings", group: "features", name: "Carrier spam call warnings", description: "Your carrier marks likely spam calls on the incoming call screen, before you answer.", ...state },
  { id: "video-calling", group: "features", name: "Carrier video calling (ViLTE)", description: "Video calls placed through the phone app over the carrier's IMS network rather than an app.", ...state },

  { id: "rtt", group: "voice", name: "Real-time text (RTT)", description: "Text that is sent character by character during a call, for people who are deaf or hard of hearing.", ...bool },
  { id: "volte-switch", group: "voice", name: "VoLTE switch shown", description: "Whether the user gets a switch to turn VoLTE off.", ...bool },
  { id: "vonr-switch", group: "voice", name: "VoNR switch shown", description: "Whether the user gets a switch to turn Voice over 5G off.", ...bool },
  { id: "audio-codecs", group: "voice", name: "Voice codecs", description: "The audio codecs the phone offers for IMS calls: AMR (narrowband), AMR-WB (HD Voice) and EVS.", ...strings },
  { id: "tty", group: "voice", name: "TTY", description: "Whether the teletypewriter mode for deaf users is offered.", ...bool },
  { id: "tty-over-ims", group: "voice", name: "TTY over IMS", description: "Whether TTY works on VoLTE calls rather than forcing a fallback to the 2G/3G network.", ...bool },
  { id: "sip-ipsec", group: "voice", name: "IPsec for SIP", description: "Whether the phone protects its IMS signalling to the network with IPsec.", ...bool },
  { id: "sip-precondition", group: "voice", name: "QoS preconditions", description: "Whether call setup waits for the network to reserve voice quality-of-service before ringing.", ...bool },
  { id: "prack-18x", group: "voice", name: "Reliable provisional responses (PRACK)", description: "Whether the phone acknowledges the network's ringing and progress messages so none are lost.", ...bool },
  { id: "conference-uri", group: "voice", name: "Conference server", description: "The address of the network service that hosts conference calls.", ...str },
  { id: "conference-size", group: "voice", name: "Conference size limit", description: "How many people a conference call can have.", ...count },
  { id: "ringing-timer", group: "voice", name: "Ringing timeout", description: "How long an outgoing call may ring before the phone gives up.", ...ms },
  { id: "ringback-timer", group: "voice", name: "Ringback timeout", description: "How long the phone waits for the other side to start ringing after dialling.", ...ms },
  { id: "session-expires", group: "voice", name: "Session refresh interval", description: "How often an IMS call is refreshed to prove both sides are still there.", ...s },
  { id: "ims-registration-expiry", group: "voice", name: "IMS registration lifetime", description: "How long an IMS registration lasts before the phone renews it.", ...s },
  { id: "ims-retry-base", group: "voice", name: "IMS registration retry (base)", description: "The first wait before retrying a failed IMS registration.", ...ms },
  { id: "ims-retry-max", group: "voice", name: "IMS registration retry (maximum)", description: "The longest wait between retries of a failed IMS registration.", ...ms },
  { id: "sip-timer-t1", group: "voice", name: "SIP timer T1", description: "The round-trip estimate SIP retransmissions start from (RFC 3261).", ...ms },
  { id: "sip-timer-t2", group: "voice", name: "SIP timer T2", description: "The longest gap between SIP retransmissions (RFC 3261).", ...ms },
  { id: "sip-timer-t4", group: "voice", name: "SIP timer T4", description: "How long a SIP message may linger in the network (RFC 3261).", ...ms },
  { id: "sip-timer-b", group: "voice", name: "SIP timer B", description: "How long the phone waits for any answer to a call attempt (RFC 3261).", ...ms },
  { id: "sip-timer-d", group: "voice", name: "SIP timer D", description: "How long the phone keeps absorbing retransmitted call-failure responses (RFC 3261).", ...ms },
  { id: "sip-timer-f", group: "voice", name: "SIP timer F", description: "How long the phone waits for any answer to a non-call request such as REGISTER (RFC 3261).", ...ms },
  { id: "sip-timer-h", group: "voice", name: "SIP timer H", description: "How long the phone waits for the acknowledgement of a call-failure response (RFC 3261).", ...ms },
  { id: "sip-timer-j", group: "voice", name: "SIP timer J", description: "How long the phone keeps answering retransmitted non-call requests (RFC 3261).", ...ms },
  { id: "sip-udp-limit", group: "voice", name: "SIP over UDP size limit", description: "SIP messages larger than this go over TCP instead of UDP.", type: "number", unit: "bytes" },
  { id: "rtp-inactivity", group: "voice", name: "RTP inactivity timeout", description: "How long a call may go without voice packets before the phone ends it.", ...ms },
  { id: "rtcp-inactivity", group: "voice", name: "RTCP inactivity timeout", description: "How long a call may go without control packets before the phone ends it.", ...ms },
  { id: "ims-user-agent", group: "voice", name: "IMS User-Agent", description: "How the phone names itself to the IMS network; placeholders stand for model and version.", ...str },

  { id: "nr-modes", group: "nr", name: "5G modes", description: "Which 5G modes the phone may use: NSA (anchored on LTE) and SA (standalone).", ...strings },
  { id: "5g-switch", group: "nr", name: "5G switch shown", description: "Whether the user gets a switch to choose between 5G and LTE.", ...bool },
  { id: "5g-icon-advanced", group: "nr", name: "Advanced 5G icon", description: "The status bar label for the carrier's fastest 5G (mmWave or wide-band), when it differs from plain 5G.", ...str },
  { id: "lte-icon", group: "nr", name: "LTE icon", description: "Whether the status bar says LTE or 4G on an LTE network.", ...str },

  { id: "wfc-mode", group: "wifi-calling", name: "Wi-Fi Calling preference", description: "What Wi-Fi Calling prefers at home: Wi-Fi, cellular, or Wi-Fi only.", ...str },
  { id: "wfc-roaming-mode", group: "wifi-calling", name: "Wi-Fi Calling preference abroad", description: "What Wi-Fi Calling prefers while roaming.", ...str },
  { id: "wfc-roaming", group: "wifi-calling", name: "Wi-Fi Calling while roaming", description: "Whether Wi-Fi Calling works, or starts on, while roaming.", ...bool },
  { id: "epdg-address", group: "wifi-calling", name: "ePDG address", description: "The network gateway Wi-Fi Calling tunnels into.", ...str },
  { id: "ike-dh-groups", group: "wifi-calling", name: "IKE key exchange groups", description: "The Diffie-Hellman groups (IANA numbers) the Wi-Fi Calling tunnel may use.", ...numbers },
  { id: "wifi-calling-name", group: "wifi-calling", name: "Name on Wi-Fi Calling", description: "The carrier name the phone shows while calls go over Wi-Fi.", ...str },

  { id: "sms-over-ims", group: "messaging", name: "SMS over IMS", description: "Whether texts are sent over the IMS network (as on VoLTE) instead of the legacy signalling channel.", ...bool },
  { id: "sms-over-ims-networks", group: "messaging", name: "SMS over IMS networks", description: "The radio networks on which texts go over IMS.", ...strings },
  { id: "mms-max-size", group: "messaging", name: "MMS size limit", description: "The largest picture or video message the phone will send.", type: "number", unit: "bytes" },
  { id: "mms-max-recipients", group: "messaging", name: "MMS recipient limit", description: "How many people a single MMS can be sent to.", ...count },
  { id: "mms-max-image", group: "messaging", name: "MMS image size", description: "The longest side, in pixels, pictures are scaled to before sending.", type: "number", unit: "px" },
  { id: "mms-max-subject", group: "messaging", name: "MMS subject length", description: "The longest subject line an MMS may carry.", type: "number", unit: "chars" },
  { id: "mms-group", group: "messaging", name: "Group MMS", description: "Whether group texts are sent as one MMS conversation rather than separate texts.", ...bool },
  { id: "mms-roaming-download", group: "messaging", name: "MMS download while roaming", description: "Whether picture messages download automatically while roaming.", ...bool },
  { id: "mmsc", group: "messaging", name: "MMS server", description: "The carrier's MMS centre that stores and forwards picture messages.", ...str },
  { id: "mms-proxy", group: "messaging", name: "MMS proxy", description: "The proxy MMS traffic goes through, when the carrier uses one.", ...str },
  { id: "mms-uaprof", group: "messaging", name: "MMS UAProf", description: "The device profile URL sent with MMS, describing what the phone can display.", ...str },
  { id: "mms-user-agent", group: "messaging", name: "MMS User-Agent", description: "How the phone names itself to the MMS server.", ...str },

  { id: "ussd-over-ims", group: "supplementary", name: "USSD over IMS", description: "Whether codes like *100# go over IMS rather than the legacy network.", ...bool },
  { id: "ss-over-ut", group: "supplementary", name: "Call settings over Ut/XCAP", description: "Whether call forwarding, waiting and caller ID settings are changed over the internet (XCAP) instead of the legacy network.", ...bool },
  { id: "xcap-server", group: "supplementary", name: "XCAP server", description: "The server that holds call forwarding and other call settings.", ...str },
  { id: "xcap-port", group: "supplementary", name: "XCAP port", description: "The port of the XCAP server.", type: "number", unit: "port" },
  { id: "bsf-server", group: "supplementary", name: "GBA bootstrap server", description: "The server the phone authenticates against before talking to the XCAP server.", ...str },
  { id: "bsf-port", group: "supplementary", name: "GBA bootstrap port", description: "The port of the bootstrap server.", type: "number", unit: "port" },

  { id: "emergency-over-ims", group: "emergency", name: "Emergency calls over IMS", description: "Whether emergency calls can be placed over VoLTE/VoNR rather than only the legacy network.", ...bool },
  { id: "emergency-numbers", group: "emergency", name: "Emergency numbers", description: "Numbers the carrier adds to the phone's list of emergency numbers.", ...strings },
  { id: "text-to-emergency", group: "emergency", name: "Text to emergency services", description: "Whether texts to emergency numbers are supported.", ...bool },
  { id: "cell-broadcast-channels", group: "emergency", name: "Cell broadcast channels", description: "The broadcast message channels (3GPP message ids) the carrier configures for alerts.", ...strings },

  { id: "apn-internet", group: "data", name: "Internet APN", description: "The access point name used for ordinary mobile data.", ...str },
  { id: "apn-mms", group: "data", name: "MMS APN", description: "The access point name picture messages are sent over.", ...str },
  { id: "apn-ims", group: "data", name: "IMS APN", description: "The access point name VoLTE and Wi-Fi Calling register over.", ...str },
  { id: "apn-emergency", group: "data", name: "Emergency APN", description: "The access point name used for emergency calls over IMS.", ...str },
  { id: "apn-xcap", group: "data", name: "XCAP APN", description: "The access point name call settings (XCAP/Ut) are changed over.", ...str },
  { id: "apn-attach", group: "data", name: "Initial attach APN", description: "The access point name the phone registers on LTE and 5G with.", ...str },
  { id: "internet-ip", group: "data", name: "Internet IP version", description: "Which IP versions mobile data uses at home: IPv4, IPv6 or both.", ...str },
  { id: "internet-ip-roaming", group: "data", name: "Internet IP version roaming", description: "Which IP versions mobile data uses while roaming.", ...str },
  { id: "data-mtu", group: "data", name: "Data MTU", description: "The largest packet mobile data sends on LTE/5G.", type: "number", unit: "bytes" },

  { id: "tethering-apn", group: "tethering", name: "Hotspot APN", description: "The separate access point name hotspot traffic uses, when the carrier requires one.", ...str },

  { id: "home-networks", group: "roaming", name: "Networks treated as home", description: "Other network codes on which the phone does not count as roaming.", ...strings },
  { id: "data-roaming-default", group: "roaming", name: "Data roaming on by default", description: "Whether mobile data roaming starts switched on.", ...bool },

  { id: "carrier-name", group: "display", name: "Carrier name", description: "The name the carrier wants the phone to show for it.", ...str },
  { id: "country-iso", group: "display", name: "Country", description: "The country the carrier settings say the SIM belongs to (ISO code).", ...str },

  { id: "voicemail-number", group: "voicemail", name: "Voicemail number", description: "The number the phone dials to reach voicemail.", ...str },
  { id: "voicemail-roaming-number", group: "voicemail", name: "Voicemail number abroad", description: "The number dialled for voicemail while roaming.", ...str },

  { id: "satellite-name", group: "satellite", name: "Satellite network name", description: "The name shown while connected to the carrier's satellite partner.", ...str },

  { id: "entitlement-server", group: "entitlement", name: "Entitlement server", description: "The carrier server the phone asks whether a plan includes Wi-Fi Calling, VoLTE and similar.", ...str },

  { id: "lte-rsrp-thresholds", group: "signal", name: "LTE signal bar thresholds", description: "The LTE signal strengths (RSRP) at which the phone shows one more bar.", type: "list", of: "number", ordered: true },
  { id: "nr-rsrp-thresholds", group: "signal", name: "5G signal bar thresholds", description: "The 5G signal strengths (SS-RSRP) at which the phone shows one more bar.", type: "list", of: "number", ordered: true },
] as const satisfies readonly ConceptDef[];

type Concept = (typeof CONCEPTS)[number];

type ConceptId = Concept["id"];

/** Features are the state concepts; their ids are the feature pages' slugs. */
export type FeatureSlug = Extract<Concept, { readonly type: "state" }>["id"];

export const FEATURE_SLUGS: readonly FeatureSlug[] = CONCEPTS.flatMap((c) => (c.type === "state" ? [c.id] : []));

type ValueOf<C extends ConceptValueSpec> =
  C extends { readonly type: "boolean" } ? boolean
  : C extends { readonly type: "number" } ? number
  : C extends { readonly type: "string" } ? string
  : C extends { readonly type: "list"; readonly of: "string" } ? readonly string[]
  : readonly number[];

type ReadingOf<C extends ConceptValueSpec> = Unset | (C extends { readonly type: "state" } ? StateReading : ValueReading<ValueOf<C>>);

/** What a reader of concept `Id` returns. */
export type Reading<Id extends ConceptId> = ReadingOf<Extract<Concept, { readonly id: Id }>>;

/** A platform's readers; a concept the platform cannot express has none. */
export type Readers<View> = { readonly [Id in ConceptId]?: (view: View) => Reading<Id> };

/** Every concept `readers` can express, read from one view. */
export function readConcepts<View>(readers: Readers<View>, view: View): Record<string, ConceptValue> {
  return Object.fromEntries(Object.entries(readers).flatMap(([id, read]) => (read === undefined ? [] : [[id, read(view)]])));
}

const BY_ID: ReadonlyMap<string, ConceptDef> = new Map(CONCEPTS.map((c) => [c.id, c]));
const ORDER: ReadonlyMap<string, number> = new Map(CONCEPTS.map((c, i) => [c.id, i]));

export const conceptById = (id: string): ConceptDef | undefined => BY_ID.get(id);

export const needs5G = (id: string): boolean => { const c = BY_ID.get(id); return c?.type === "state" && c.needs5G; };

/** Registry position, for stable row order; unknown ids sort last. */
export const conceptOrder = (id: string): number => ORDER.get(id) ?? CONCEPTS.length;
