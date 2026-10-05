/**
 * Title and description from the route and the names its codes have, so the head survives a
 * failed pane and is the same for every visitor. Written for what people search: the file's
 * own name (`ATT_US.ipcc`, `att_us.pb`) or the brand and a setting.
 */

import { countryName } from "@carrier-explode/schema";
import { isPlatform, isReleasePlatform, shipsKind, type Platform, type ReleasePlatform } from "@carrier-explode/schema/types";
import { androidBuildSeo } from "./android/seo";
import { iosBuildSeo } from "./apple/seo";
import { featurePage } from "./feature-pages";
import type { Tab } from "../params";
import { versionLabel } from "./names";
import { PLATFORM_DEVICES } from "./platforms";
import type { PageNames } from "./types";

export const SITE = "carrier-explode";

/** The route's params, as SvelteKit types them: any may be absent. */
type Params = Readonly<Partial<Record<"kind" | "platform" | "name" | "line" | "version" | "tab" | "path" | "build" | "modem" | "feature" | "iso", string | undefined>>>;
type Meta = { title: string; description: string };

/** A build page's head, as its platform words it: title candidates longest first, and the terms its description lists when they fit. */
interface BuildMeta {
  readonly titles: readonly [string, ...string[]];
  readonly description: string;
  readonly terms?: readonly string[];
}

/** How a platform's builds are searched for. */
export interface BuildSeo {
  readonly index: Meta;
  readonly build: (build: string, release: string) => BuildMeta;
  readonly modem: (build: string, release: string, modem: string, names: PageNames["modem"]) => BuildMeta;
}

const BUILD_SEO = { ios: iosBuildSeo, android: androidBuildSeo } as const satisfies Record<ReleasePlatform, BuildSeo>;

// Google shows about 60 characters of title and 155 of description, and
// " · carrier-explode" (18) is appended to every title.
const TITLE_MAX = 52;
const DESC_MAX = 160;

/** The first candidate that fits; the last one is used regardless. */
const fit = (max: number, first: string, ...rest: string[]): string => [first, ...rest].find((o) => o.length <= max) ?? rest.at(-1) ?? first;

/** `head` then as many of `terms` as fit, in order, then `tail`. */
function listing(head: string, terms: readonly string[], tail = "."): string {
  for (let n = terms.length; n > 0; n--) {
    const t = terms.slice(0, n);
    const s = `${head}${t.slice(0, -1).join(", ")}${t.length > 1 ? " and " : ""}${t.at(-1)}${tail}`;
    if (s.length <= DESC_MAX) return s;
  }
  return fit(DESC_MAX, head.replace(/[:,]\s*$/, "") + tail, head.slice(0, DESC_MAX - 1) + "…");
}

// What people search a carrier bundle for, most asked first.
const CARRIER_TERMS = ["APN", "VoLTE", "5G", "Wi-Fi Calling", "MCC/MNC", "RCS", "hotspot", "MMS", "visual voicemail"];
const WATCH_TERMS = ["LTE", "eSIM", "VoLTE", "Wi-Fi Calling", "APN", "MCC/MNC"];
const COUNTRY_TERMS = ["emergency alerts", "cell broadcast channels", "which alerts you can turn off", "emergency numbers"];

interface Device {
  readonly device: string;
  readonly noun: string;
  readonly terms: readonly string[];
  /** The file names people paste into a search box. */
  readonly files: (name: string) => string;
  readonly history: string;
}

const appleFiles = (n: string): string => `${n}.bundle / ${n}.ipcc`;

/** The device a platform's settings are for, and the words its readers search with. */
const DEVICE = {
  ios: { device: PLATFORM_DEVICES.ios, noun: "carrier bundle", terms: CARRIER_TERMS, files: appleFiles, history: "every iOS version and beta" },
  ipados: { device: PLATFORM_DEVICES.ipados, noun: "iPad carrier bundle", terms: CARRIER_TERMS, files: appleFiles, history: "every iPadOS version" },
  watchos: { device: PLATFORM_DEVICES.watchos, noun: "Apple Watch carrier bundle", terms: WATCH_TERMS, files: appleFiles, history: "every watchOS version" },
  android: { device: PLATFORM_DEVICES.android, noun: "Android carrier settings", terms: CARRIER_TERMS, files: (n) => `${n}.pb`, history: "every Pixel and Android release" },
} as const satisfies Record<Platform, Device>;

type Who = Device & { readonly name: string; readonly label: string; readonly full: string };

function who(p: Params, source: PageNames["source"]): Who {
  const name = p.name ?? "";
  const platform: Platform = p.platform !== undefined && isPlatform(p.platform) ? p.platform : "ios";
  const d: Device = DEVICE[platform];
  const label = source?.brand ?? name;
  if (p.kind === "countries") return { ...d, name, label, full: label, noun: "country bundle", terms: COUNTRY_TERMS };
  // O2_Germany, TIM_Italy: the country is already in the name.
  const country = source?.country;
  return { ...d, name, label, full: country && !label.endsWith(country) ? `${label} ${country}` : label };
}

// `what` runs straight into `terms` when there are any.
const TABS: Record<Tab, { title: string; what: string; terms?: string[] }> = {
  settings: {
    title: "settings", what: "every setting decoded, with each phone's overrides: ",
    terms: ["APN", "VoLTE", "5G", "Wi-Fi Calling", "what only this carrier sets"],
  },
  modem: {
    title: "modem settings", what: "modem overrides (.der.pri) per iPhone decoded into ",
    terms: ["NV items", "EFS paths", "band combos", "carrier configuration bitfields"],
  },
  alerts: {
    title: "emergency alerts", what: "emergency alert switches and ",
    terms: ["cell broadcast message IDs", "which alerts you can turn off", "alert titles"],
  },
  changes: { title: "what changed", what: "every setting changed since the version before, key by key" },
  files: { title: "files", what: "every file in the bundle" },
  apns: { title: "APNs", what: "every APN with its types and protocols" },
};

const isTab = (t: string): t is Tab => Object.hasOwn(TABS, t);

function bundle(p: Params, source: PageNames["source"]): Meta {
  const w = who(p, source);
  const n = w.name;

  if (p.version) {
    const v = versionLabel(p.version);

    if (p.path) {
      return {
        title: fit(TITLE_MAX, `${p.path} — ${n} ${v}`, `${p.path} — ${n}`, p.path),
        description: listing(`${p.path} from the ${w.full} ${w.noun} (${n}, ${v}), decoded key by key`, []),
      };
    }
    const t = p.tab !== undefined && isTab(p.tab) ? TABS[p.tab] : undefined;
    if (t) {
      return {
        title: fit(TITLE_MAX, `${n} ${t.title} — ${v}`, `${n} ${t.title}`, `${n} — ${t.title}`, n),
        description: listing(`${w.full} ${w.noun} ${n}, ${v}: ${t.what}`, t.terms ?? []),
      };
    }
    return {
      title: fit(TITLE_MAX, `${n} ${v} — ${w.label} ${w.noun}`, `${n} ${v} — ${w.label}`, `${n} ${v} — ${w.noun}`, `${n} ${v}`),
      description: listing(`${w.full} ${w.noun} ${n} as shipped in ${v}, decoded: `, w.terms, ", and what changed."),
    };
  }

  return {
    title: fit(TITLE_MAX,
      `${n} — ${w.full} ${w.noun}`, `${n} — ${w.label} ${w.noun}`, `${n} — ${w.label}`, `${n} — ${w.noun}`, n),
    description: listing(
      p.kind === "countries"
        ? `${w.full} ${w.device} country bundle (${n}.bundle), decoded: `
        : `${w.full} ${w.device} carrier settings from ${w.files(n)}, decoded: `,
      [...w.terms, w.history],
    ),
  };
}

export function seo(id: string | null, p: Params, names: PageNames): Meta {
  if (p.name) return bundle(p, names.source);

  if (p.feature) {
    const f = featurePage(p.feature);
    if (f) {
      return {
        title: fit(TITLE_MAX, `Which carriers support ${f.name} on iPhone and Pixel?`, `${f.name} on iPhone and Pixel: carriers`, `${f.name}: carriers`, f.name),
        description: fit(DESC_MAX,
          `Does your carrier support ${f.name} on your iPhone or Pixel? Every carrier, checked for each model. ${f.what}`,
          `Does your carrier support ${f.name} on your iPhone or Pixel? Every carrier, checked for each model.`),
      };
    }
  }

  if (p.platform !== undefined && isReleasePlatform(p.platform) && p.build !== undefined) {
    const s = BUILD_SEO[p.platform];
    const release = names.release ?? p.build;
    const m = p.modem === undefined ? s.build(p.build, release) : s.modem(p.build, release, p.modem, names.modem);
    const [first, ...rest] = m.titles;
    return { title: fit(TITLE_MAX, first, ...rest), description: m.terms?.length ? listing(m.description, m.terms) : fit(DESC_MAX, m.description) };
  }

  const platform: Platform = p.platform !== undefined && isPlatform(p.platform) ? p.platform : "ios";
  if (id === "/[platform=platform]/builds" && isReleasePlatform(platform)) return BUILD_SEO[platform].index;
  const device = PLATFORM_DEVICES[platform];
  switch (id) {
    case "/[platform=platform]/[kind=kind]/[iso=iso]": {
      const country = (p.iso !== undefined ? countryName(p.iso) : undefined) ?? "a country";
      return {
        title: fit(TITLE_MAX, `${device} carrier settings in ${country}`, `Carriers in ${country}`),
        description: `Every ${device} carrier settings file for a carrier in ${country}, decoded: APN, VoLTE, 5G, Wi-Fi Calling and MCC/MNC.`,
      };
    }
    case "/[platform=platform]/[kind=kind]":
      if (p.kind === "countries" && !shipsKind(platform, "country")) {
        return {
          title: `${device} carriers by country`,
          description: `Every ${device} carrier settings file, by the country of its carrier: APN, VoLTE, 5G, Wi-Fi Calling and MCC/MNC.`,
        };
      }
      return p.kind === "countries"
        ? {
            title: `${device} country bundles (emergency alerts)`,
            description:
              `Every ${device} country bundle, decoded: emergency alert and cell broadcast settings, which alerts you can't turn off, and the carriers in each country.`,
          }
        : {
            title: fit(TITLE_MAX, `${device} carrier settings — all carriers`, `${device} carrier settings`),
            description: `Every ${DEVICE[platform].noun} for the ${device}, decoded: APN, VoLTE, 5G, Wi-Fi Calling and MCC/MNC for every carrier, side by side.`,
          };
    case "/features":
      return {
        title: "Carrier features by carrier, iPhone and Pixel",
        description:
          "Does your carrier support 5G Standalone, Voice over 5G, Wi-Fi Calling, RCS or satellite texting on your iPhone or Pixel? Check every carrier, for your model.",
      };
    case "/compare":
      return {
        title: "Compare carrier settings",
        description: "Diff two carrier bundles or Android carrier settings key by key, across carriers, versions or platforms.",
      };
    case "/wiki":
      return {
        title: "Carrier settings wiki: iOS and Android",
        description: "How iOS carrier bundles and Pixel carrier settings are built, matched to a SIM and delivered, and the modem configuration files that ship with them.",
      };
    default:
      return {
        title: "iPhone carrier bundles & carrier settings, decoded",
        description:
          "Browse and download every iPhone carrier bundle (.ipcc) and country bundle Apple ships, decoded: APN, VoLTE, 5G, Wi-Fi Calling, MCC/MNC, iOS betas.",
      };
  }
}
