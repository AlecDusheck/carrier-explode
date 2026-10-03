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

- [Carrier bundles](${url.origin}/carriers): every carrier bundle, and a lookup from MCC-MNC, ICCID prefix or carrier ID to the bundle a SIM loads (\`/carriers?q=310410\`)
- [Country bundles](${url.origin}/countries): per-country bundles, and every country's emergency alerts side by side
- [Apple Watch bundles](${url.origin}/watch)
- [iOS builds](${url.origin}/builds): bundles added and changed in each iOS build, and the modem firmware each one ships
- [Sitemap](${url.origin}/sitemap.xml)

## Bundle pages

Every bundle file is shown decoded. \`<kind>\` is \`carriers\`, \`countries\` or \`watch\`; \`<version>\` is \`ota-<build>\` for a published download (\`ota-72.1\`) or \`ios-<iOS version>\` for the copy inside an iOS image (\`ios-27.0.1\`, \`ios-27.2-beta-2\`).

- \`/<kind>/<name>\`: versions, newest first
- \`/<kind>/<name>/<version>/settings\`: carrier.plist with a phone's overrides (\`?file=overrides_<phones>.der.pri\`), marking what few other bundles share
- \`/<kind>/<name>/<version>/modem\`: a phone's modem override file decoded, and the modem defaults it replaces
- \`/countries/<name>/<version>/alerts\`: a country's emergency alert switches and message IDs
- \`/<kind>/<name>/<tab>\`: a tab of the current version, e.g. \`/carriers/ATT_US/settings\`
- \`/<kind>/<name>/<version>/files\`: every file, with the phones each overrides pair is for
- \`/<kind>/<name>/<version>/files/<path>\`: one file, e.g. \`files/overrides_D93_D94_D47_D48.plist\`
- \`/<kind>/<name>/<version>/changes\`: what changed since the previous version
- \`/compare?a=<name>&av=<version>&b=<name>&bv=<version>&file=<path>\`: one file across two bundles or versions, e.g. \`/compare?a=ATT_US&av=ota-72.1&b=ATT_NR_US&bv=ota-72.1&file=overrides_D93_D94_D47_D48.plist\`

A copy inside an iOS image only has the overrides for the phones that image is for; a published download has them for all phones.
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
