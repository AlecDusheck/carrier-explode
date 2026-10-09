import { PLATFORMS } from "@carrier-explode/schema/types";
import { env } from "cloudflare:workers";
import { SECTION_ARTICLES, SITE_ARTICLES, type Article } from "#lib/wiki.ts";

/** The llms.txt index (llmstxt.org): what the site is, and where an agent should read first. */
export function GET({ url }) {
	const entry = (a: Article) => `- [${a.title}](${url.origin}/wiki/${a.path}): ${a.description}`;
	const platforms = PLATFORMS.map((p) => `\`${p}\``).join(", ");
	const body = `# carrier-explode

> The carrier settings Apple, Google and Samsung ship, decoded: iPhone, iPad and Apple Watch carrier and country bundles (carrier.plist, per-phone baseband overrides), Pixel carrier settings (CarrierSettings protobufs, per device), and US Galaxy carrier packs (one per sales code, per model). Version history, the modem firmware in each build, and any two sources compared side by side. The wiki explains the formats; the source pages show the live data.

## API

To read the data, use the API rather than the pages: JSON, decoded, no key. Paging, caching and rate limits are in the wiki's API article.

- [Index](${env.API_ORIGIN}/v1): every collection, with an example request
- [OpenAPI document](${env.API_ORIGIN}/openapi.json): every route, parameter and response schema; lists are paged by cursor, so follow \`next.url\`
- Across platforms: \`/v1/carriers?q=<a carrier or source name>\`, then \`/v1/carriers/<id>/features?feature=volte\` (states per phone), \`…/profiles?fields=apns\` (each platform's file decoded), \`…/modems\`; \`/v1/features/<feature>?country=jp\`; \`/v1/devices/<code>/modems\`; \`/v1/sims?mccmnc=<plmn>\`; \`/v1/compare?a=<source>&b=<source>\`
- Per platform: \`/v1/<platform>/<kind>/<name>/versions/latest\`, \`…/versions/<version>/settings\`; \`/v1/<platform>/builds?version=<os>\`, \`…/builds/<build>/changes?carrier=<id>\`, \`…/builds/<build>/modems\`
- [Dataset](${url.origin}/datasets/carrier-explode.zip): every source's head and the lists above as the API's JSON, with Pixel and Galaxy settings in AOSP's XML, in one daily CC0 zip; its layout is the [Datasets](${url.origin}/wiki/datasets) article

${SECTION_ARTICLES.map(({ section, topics, carriers }) =>
	[
		`## Wiki: ${section.title}\n\n${topics.map(entry).join("\n")}`,
		...(carriers.length ? [`## Wiki: ${section.title} carriers\n\n${carriers.map(entry).join("\n")}`] : []),
	].join("\n\n"),
).join("\n\n")}

## Wiki: this site

${SITE_ARTICLES.map(entry).join("\n")}

## Data

- [Carriers](${url.origin}/ios/carriers): one platform's carrier sources, \`/<platform>/carriers\` (${platforms})
- [Carrier features](${url.origin}/), the home page: every carrier against every feature (5G Standalone, Voice over 5G, Wi-Fi Calling, RCS, satellite and more) on one iPhone, Pixel or Galaxy, filtered by required features (\`/?phone=tokay&need=sa,vonr,wfc\`); one feature's carriers at \`/features/<feature>?phone=iPhone19,3\`
- [Country bundles](${url.origin}/ios/countries): each one's emergency alerts (\`/ios/countries/<name>/alerts\`), emergency numbers and carriers; \`/android/countries\` lists Android's carriers by country (\`/android/countries/us\`)
- [Builds](${url.origin}/ios/builds): \`/ios/builds\`, \`/android/builds\` and \`/samsung/builds\`; each build (\`/<platform>/builds/<build>\`) lists the sources it added and changed, and the modems it ships, if any (none for an Exynos Galaxy, whose modem is encrypted) (\`/ios/builds/<build>/<package>\`, \`/android/builds/<build>/<device>\`, \`/samsung/builds/<build>/<model>\`)

## Source pages

\`<kind>\` is \`carriers\`, \`countries\` or \`defaults\`; \`<platform>\` is one of ${platforms}. \`<version>\` is the file's own version (\`72.0\`), with where it was first seen when one version shipped twice (\`64.1@23a341\` for an iOS build, \`50.1@2022-04-12\` for an OTA download). Android settings differ per Pixel, so their versions sit under a device line, the Pixel's codename (\`/android/carriers/tmobile_us/tokay/79000000034\`); a Galaxy pack's sit under its model (\`/samsung/carriers/TMB/SM-S942U/17.0013\`).

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
