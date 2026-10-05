import { PLATFORMS } from "@carrier-explode/schema/types";
import { API_ORIGIN } from "#lib/public-api.ts";
import { SECTION_ARTICLES, SITE_ARTICLES, type Article } from "#lib/wiki.ts";

/** The llms.txt index (llmstxt.org): what the site is, and where an agent should read first. */
export function GET({ url }) {
  const entry = (a: Article) => `- [${a.title}](${url.origin}/wiki/${a.path}): ${a.description}`;
  const platforms = PLATFORMS.map((p) => `\`${p}\``).join(", ");
  const body = `# carrier-explode

> Every carrier settings file Apple and Google ship, decoded: iPhone, iPad and Apple Watch carrier and country bundles (carrier.plist, per-phone baseband overrides), and Pixel carrier settings (CarrierSettings protobufs, per device). Version history, the baseband firmware in each iOS image, and any two sources compared side by side. The wiki explains the formats; the source pages show the live data.

## API

To read the data, use the API rather than the pages: JSON, decoded, no key. The wiki's API article below says how it pages, caches and limits.

- [OpenAPI document](${API_ORIGIN}/openapi.json): every route under \`${API_ORIGIN}/v1\`, platform first (\`/v1/ios/carriers/ATT_US/latest\`); lists are paged by cursor, so follow \`next.url\`

${SECTION_ARTICLES.map(({ section, topics, carriers }) => [
    `## Wiki: ${section.title}\n\n${topics.map(entry).join("\n")}`,
    ...(carriers.length ? [`## Wiki: ${section.title} carriers\n\n${carriers.map(entry).join("\n")}`] : []),
  ].join("\n\n")).join("\n\n")}

## Wiki: this site

${SITE_ARTICLES.map(entry).join("\n")}

## Data

- [Carriers](${url.origin}/ios/carriers): one platform's carrier sources, \`/<platform>/carriers\` (${platforms})
- [Carrier features](${url.origin}/features): which carriers offer 5G Standalone, Voice over 5G, Wi-Fi Calling, RCS, satellite and more, per iPhone or Pixel (\`/features/<feature>?phone=iPhone19,3\`, \`?phone=tokay\`)
- [Country bundles](${url.origin}/ios/countries): each one's emergency alerts (\`/ios/countries/<name>/alerts\`), emergency numbers and carriers; \`/android/countries\` lists Android's carriers by country (\`/android/countries/us\`)
- [Builds](${url.origin}/ios/builds): \`/ios/builds\` and \`/android/builds\`; each build (\`/<platform>/builds/<build>\`) lists the sources it added and changed, and the modems it ships (\`/ios/builds/<build>/<package>\`, \`/android/builds/<build>/<device>\`)
- [Sitemap](${url.origin}/sitemap.xml)

## Source pages

\`<kind>\` is \`carriers\`, \`countries\` or \`defaults\`; \`<platform>\` is one of ${platforms}. \`<version>\` is the file's own version (\`72.0\`), with where it was first seen when one version shipped twice (\`64.1@23a341\` for an iOS build, \`50.1@2022-04-12\` for an OTA download). Android settings differ per Pixel, so their versions sit under a device line, the Pixel's codename (\`/android/carriers/tmobile_us/tokay/79000000034\`).

- \`/<platform>/<kind>/<name>\`: the newest version's overview: where it came from and its copies (Apple bundles add their digests and the SIMs that select them)
- \`/<platform>/<kind>/<name>/<version>/settings\`: every setting decoded (Apple: carrier.plist with a phone's overrides, \`?file=overrides_<phones>.der.pri\`; Android: every config key, with Android's own description)
- \`/<platform>/<kind>/<name>/<version>/modem\`: an iPhone's modem override file decoded, and the modem defaults it replaces; on a Pixel, the modem configurations its SIMs select
- \`/android/carriers/<name>/<device>/<version>/apns\`: a Pixel's APNs
- \`/ios/countries/<name>/<version>/alerts\`: a country's emergency alert switches and message IDs
- \`/<platform>/<kind>/<name>/<tab>\`: a tab of the newest version, e.g. \`/ios/carriers/ATT_US/settings\`
- \`/<platform>/<kind>/<name>/<version>/files\`: every file (Apple) or the protobuf as-is (Android)
- \`/<platform>/<kind>/<name>/<version>/changes\`: what changed since the previous version
- \`/compare?a=<source>&av=<version>&b=<source>&bl=<device>&bv=<version>&file=<path>\`: two sources, any platforms (\`<source>\` is \`<platform>:<kind>:<name>\`, e.g. \`ios:carrier:ATT_US\`); two Apple bundles compare file by file, anything with Android setting by setting

A copy inside an iOS image only has the overrides for the phones that image is for; a published download has them for all phones.
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
