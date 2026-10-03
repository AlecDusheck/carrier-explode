/**
 * Title and description for a page, from the route alone — no data fetch, so
 * the head is right even when a pane fails, and identical for every visitor, so
 * a cached page can still be shared.
 *
 * Written for what people type into a search box. That is either the bundle's
 * own name, copied out of a log or a file listing (`ATT_US`, `ATT_US.bundle`,
 * `ATT_US.ipcc`), or the brand and the setting they are after ("AT&T carrier
 * settings VoLTE", "Jio 5G carrier bundle"). So a bundle page carries both
 * spellings of the name, the country, and the settings people hunt for: APN,
 * VoLTE, 5G, Wi-Fi Calling, RCS, hotspot, MCC/MNC.
 */

import { modemLabel, modemName, modemVendor } from "./decode/modem";
import { featureBySlug } from "./features";
import { buildLabel, carrierName, countryDisplay, versionLabel } from "./names";

export const SITE = "carrier-explode";

type Params = { kind?: string; name?: string; version?: string; path?: string; build?: string; family?: string; feature?: string };
type Meta = { title: string; description: string };

// Google shows about 60 characters of title and 155 of description, and
// " · carrier-explode" (18) is appended to every title.
const TITLE_MAX = 52;
const DESC_MAX = 160;

/** The first candidate that fits; the last one is used regardless. */
const fit = (max: number, ...options: string[]) => options.find((o) => o.length <= max) ?? options[options.length - 1];

/** `head` then as many of `terms` as fit, in order, then `tail`. */
function listing(head: string, terms: string[], tail = "."): string {
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

function who(p: Params) {
  const name = p.name ?? "";
  if (p.kind === "countries") {
    const country = countryDisplay(name);
    return { name, label: country, full: country, noun: "country bundle", terms: COUNTRY_TERMS, device: "iPhone" };
  }
  const { brand, country } = carrierName(name);
  const watch = p.kind === "watch";
  return {
    name, label: brand, full: country ? `${brand} ${country}` : brand,
    noun: watch ? "Apple Watch carrier bundle" : "carrier bundle",
    terms: watch ? WATCH_TERMS : CARRIER_TERMS,
    device: watch ? "Apple Watch" : "iPhone",
  };
}

// `what` runs straight into `terms` when there are any.
const TABS: Record<string, { title: string; what: string; terms?: string[] }> = {
  settings: {
    title: "settings", what: "carrier.plist with each iPhone's overrides, every key decoded: ",
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
};

function bundle(id: string, p: Params): Meta {
  const w = who(p);
  const n = w.name;

  if (p.version) {
    const v = versionLabel(p.version);
    const tab = /\/\[version=version\]\/(\w+)/.exec(id)?.[1];

    if (p.path) {
      return {
        title: fit(TITLE_MAX, `${p.path} — ${n} ${v}`, `${p.path} — ${n}`, p.path),
        description: listing(`${p.path} from the ${w.full} ${w.noun} (${n}, ${v}), decoded key by key`, [], "."),
      };
    }
    const t = tab && TABS[tab];
    if (t) {
      return {
        title: fit(TITLE_MAX, `${n} ${t.title} — ${v}`, `${n} ${t.title}`, `${n} — ${t.title}`, n),
        description: listing(`${w.full} ${w.noun} ${n}, ${v}: ${t.what}`, t.terms ? t.terms : [], "."),
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
        ? `${w.full} iPhone country bundle (${n}.bundle), decoded: `
        : `${w.full} ${w.device} carrier settings from ${n}.bundle / ${n}.ipcc, decoded: `,
      [...w.terms, "every iOS version and beta"],
    ),
  };
}

export function seo(id: string | null, p: Params): Meta {
  if (p.name) return bundle(id ?? "", p);

  if (p.feature) {
    const f = featureBySlug(p.feature);
    if (f) {
      return {
        title: fit(TITLE_MAX, `Which carriers support ${f.name} on iPhone?`, `${f.name} on iPhone: carriers`, f.name),
        description: fit(DESC_MAX,
          `Does your carrier support ${f.name} on your iPhone? Every carrier, checked for each iPhone model. ${f.what}`,
          `Does your carrier support ${f.name} on your iPhone? Every carrier, checked for each iPhone model.`),
      };
    }
  }

  if (p.build && p.family && id?.startsWith("/builds")) {
    const ios = buildLabel(p.build);
    const f = p.family;
    const named = modemName(f);
    const short = named && !named.endsWith(" " + f) ? `${named} (${f})` : modemLabel(f);
    const vendor = modemVendor(f);
    return {
      title: fit(TITLE_MAX, `${ios} ${short} modem firmware (${p.build})`, `${ios} ${short} modem firmware`, `${ios} ${short} (${p.build})`, `${p.build} ${f} modem`),
      description: vendor === "qualcomm"
        ? listing(`The ${short} baseband package in ${ios} build ${p.build}, for the iPhones it serves, decoded: `,
            ["band combos per carrier", "policyman rules", "A-MPR power tables", "modem configs", "what changed"])
        : vendor === "apple"
          ? `The ${short} modem firmware in ${ios} build ${p.build}: version, build date and chip, and where its carrier settings come from instead.`
          : `The ${short} modem package in ${ios} build ${p.build}: its version, the iPhones it serves, and why it holds no plaintext config.`,
    };
  }
  if (p.build) {
    const ios = buildLabel(p.build);
    return {
      title: fit(TITLE_MAX, `${ios} (${p.build}) carrier bundles and modems`, `${ios} carrier bundles and modems`, `${p.build} carrier bundles`),
      description: `Carrier and country bundles added, removed and changed in ${ios} build ${p.build}, and the modem package for each iPhone in it.`,
    };
  }

  switch (id) {
    case "/[kind=kind]":
      return p.kind === "countries"
        ? {
            title: "iOS country bundles (emergency alerts)",
            description:
              "Every iPhone country bundle, decoded: emergency alert and cell broadcast settings, which alerts you can't turn off, and the carriers in each country.",
          }
        : p.kind === "watch"
          ? {
              title: "Apple Watch carrier bundles (cellular)",
              description:
                "Every Apple Watch cellular carrier bundle, decoded: LTE, eSIM, VoLTE and APN settings for each carrier, with every version Apple shipped.",
            }
          : {
              title: "iPhone carrier bundles (.ipcc) — all carriers",
              description:
                "Every iPhone carrier bundle (.ipcc) Apple ships, decoded: APN, VoLTE, 5G, Wi-Fi Calling and RCS for every carrier, and which bundle a SIM's MCC/MNC loads.",
            };
    case "/features":
      return {
        title: "iPhone carrier features by carrier and model",
        description:
          "Does your carrier support 5G Standalone, Voice over 5G, Wi-Fi Calling, RCS or satellite texting on your iPhone? Check every carrier, for your iPhone model.",
      };
    case "/sim":
      return {
        title: "Which iPhone carrier bundle does my SIM load?",
        description:
          "Look up an MCC/MNC (PLMN), ICCID prefix or SIM GID1/GID2 and find the iOS carrier bundle it loads, with the MVNO rules Apple matches first.",
      };
    case "/compare":
      return {
        title: "Compare carrier bundles",
        description: "Diff two iOS carrier or country bundles key by key, across carriers or across versions.",
      };
    case "/wiki":
      return {
        title: "Carrier bundle wiki",
        description: "How iOS carrier and country bundles are built, matched to a SIM, signed and delivered, and what the modem override files inside them do.",
      };
    case "/builds":
      return {
        title: "iOS builds — carrier bundle and modem changes",
        description:
          "Every iOS release and beta, with the carrier and country bundles it added, removed or changed, and the modem firmware it ships for each iPhone.",
      };
    default:
      return {
        title: "iPhone carrier bundles & carrier settings, decoded",
        description:
          "Browse and download every iPhone carrier bundle (.ipcc) and country bundle Apple ships, decoded: APN, VoLTE, 5G, Wi-Fi Calling, MCC/MNC, iOS betas.",
      };
  }
}
