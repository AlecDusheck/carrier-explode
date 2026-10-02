import { CARRIERS, TOPICS, type Article } from "#lib/wiki.ts";

/** The llms.txt index (llmstxt.org): what the site is, and where an agent should read first. */
export function GET({ url }) {
  const entry = (a: Article) => `- [${a.title}](${url.origin}/wiki/${a.slug}): ${a.description}`;
  const body = `# carrier-explode

> Every iOS carrier and country bundle Apple has published, decoded: carrier.plist settings, per-phone baseband overrides (.der.pri), version history, and the baseband firmware in each iOS image. The wiki explains the formats; the bundle pages show the live data.

## Wiki

${TOPICS.map(entry).join("\n")}

## Carriers

${CARRIERS.map(entry).join("\n")}

## Data

- [Carrier bundles](${url.origin}/carriers): every carrier bundle, each with its full version history and decoded files
- [Country bundles](${url.origin}/countries): per-country bundles, mostly emergency alert settings
- [Apple Watch bundles](${url.origin}/watch)
- [Cell broadcast](${url.origin}/cell-broadcast): emergency alert channels and names by country
- [PLMN](${url.origin}/plmn): MCC/MNC to network
- [Baseband](${url.origin}/baseband): modem firmware in each iOS image
- [Releases](${url.origin}/releases): bundles added and changed in each iOS build
- [Sitemap](${url.origin}/sitemap.xml)
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
