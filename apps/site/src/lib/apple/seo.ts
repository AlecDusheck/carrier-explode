/** What an iOS build's pages are searched for: the build and the modem packages in it. */

import { modemVendor } from "@carrier-explode/decode-ios";
import type { BuildSeo } from "#lib/seo.ts";

/** What a package's page holds, by its vendor: Qualcomm's ship plaintext defaults, Apple's carry their settings in the bundles. */
const modemWhat = (generation: string, label: string, release: string, build: string): string => {
  const vendor = modemVendor(generation);
  if (vendor === "qualcomm") return `The ${label} baseband package in ${release} build ${build}, for the iPhones it serves, decoded: `;
  if (vendor === "apple") return `The ${label} modem firmware in ${release} build ${build}: version, build date and chip, and where its carrier settings come from instead.`;
  return `The ${label} modem package in ${release} build ${build}: its version, the iPhones it serves, and why it holds no plaintext config.`;
};

export const iosBuildSeo: BuildSeo = {
  index: {
    title: "iOS builds — carrier bundle changes",
    description: "Every iOS release, with the carrier bundles it added, removed or changed, and the modem firmware each build ships for each iPhone.",
  },
  build: (build, release) => ({
    titles: [`${release} (${build}) carrier bundles and modems`, `${release} carrier bundles and modems`, `${build} carrier bundles`],
    description: `Carrier and country bundles added, removed and changed in ${release} build ${build}, and the modem package for each iPhone in it.`,
  }),
  modem: (build, release, modem, names) => {
    const label = names?.label ?? modem;
    return {
      titles: [`${release} ${label} modem firmware (${build})`, `${release} ${label} modem firmware`, `${release} ${label} (${build})`, `${build} ${modem} modem`],
      description: modemWhat(modem, label, release, build),
      terms: modemVendor(modem) === "qualcomm" ? ["band combos per carrier", "policyman rules", "A-MPR power tables", "modem configs", "what changed"] : [],
    };
  },
};
