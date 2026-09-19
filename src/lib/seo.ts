/**
 * Title and description for a page, from the route alone — no data fetch, so
 * the head is right even when a pane fails, and identical for every visitor, so
 * a cached page can still be shared.
 *
 * The terms are the ones people search with: "carrier bundle" and the `.ipcc`
 * extension, "carrier settings" (what iOS calls it on the About screen), and the
 * settings they are usually hunting for — APN, VoLTE, Wi-Fi Calling, MCC/MNC.
 */

export const SITE = "carrier-explode";

type Params = { kind?: string; name?: string; version?: string; path?: string; build?: string; country?: string };

const KIND: Record<string, string> = { countries: "country", watch: "Apple Watch carrier" };

export function seo(id: string | null, p: Params): { title: string; description: string } {
  const kind = KIND[p.kind ?? ""] ?? "carrier";

  if (p.name && p.path) {
    return {
      title: `${p.path} — ${p.name} ${p.version}`,
      description: `${p.path} from the ${p.name} ${kind} bundle (${p.version}), decoded key by key.`,
    };
  }
  if (p.name && p.version) {
    return {
      title: `${p.name} ${p.version} — iOS ${kind} bundle`,
      description: `${p.name} ${p.version} decoded: APN, VoLTE, Wi-Fi Calling, MCC/MNC and cell broadcast values, and what changed from the version before.`,
    };
  }
  if (p.name) {
    return {
      title: `${p.name} — iOS ${kind} bundle`,
      description: `Carrier settings Apple ships for ${p.name}: APN, VoLTE, Wi-Fi Calling, MCC/MNC and cell broadcast, decoded, with every published version.`,
    };
  }
  if (p.build) {
    return {
      title: `iOS build ${p.build} — carrier bundles`,
      description: `Carrier and country bundles added, removed and changed in iOS build ${p.build}.`,
    };
  }
  if (p.country) {
    return {
      title: `${p.country} — cell broadcast settings`,
      description: `Emergency alert and cell broadcast settings iOS ships for ${p.country}, decoded from its country bundle.`,
    };
  }

  switch (id) {
    case "/[kind=kind]":
      return p.kind === "countries"
        ? {
            title: "iOS country bundles",
            description:
              "Every iOS country bundle, decoded: cell broadcast and emergency alert settings, ISO codes, and the carriers in each country.",
          }
        : p.kind === "watch"
          ? {
              title: "Apple Watch carrier bundles",
              description: "Carrier bundles iOS ships for Apple Watch, decoded, with the version history of each one.",
            }
          : {
              title: "iOS carrier bundles",
              description:
                "Every iOS carrier bundle (.ipcc) Apple ships, decoded: APN, VoLTE, Wi-Fi Calling, MCC/MNC and cell broadcast settings, with version history.",
            };
    case "/plmn":
      return {
        title: "MCC/MNC (PLMN) codes",
        description: "Mobile country and network codes mapped to carriers, straight out of Apple's carrier bundles.",
      };
    case "/cell-broadcast":
      return {
        title: "Cell broadcast settings by country",
        description: "Emergency alert and cell broadcast settings as iOS ships them, country by country, side by side.",
      };
    case "/compare":
      return {
        title: "Compare carrier bundles",
        description: "Diff two iOS carrier or country bundles key by key, across carriers or across versions.",
      };
    case "/releases":
      return {
        title: "iOS releases",
        description: "Which carrier and country bundles each iOS build shipped, and what changed between builds.",
      };
    default:
      return {
        title: "iOS carrier and country bundles, decoded",
        description:
          "Every iOS carrier and country bundle Apple ships, decoded: APN, VoLTE, Wi-Fi Calling, MCC/MNC and cell broadcast settings, with version history.",
      };
  }
}
