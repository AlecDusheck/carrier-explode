/** What a Pixel build's pages are searched for: the build and the modem firmware in it. */

import type { BuildSeo } from "#lib/seo.ts";

export const androidBuildSeo: BuildSeo = {
	index: {
		title: "Pixel builds — carrier settings changes",
		description:
			"Every Pixel build, with the Android carrier settings it added, removed or changed, and the modem firmware it ships for each Pixel.",
	},
	build: (build, release, compared) =>
		compared
			? {
					titles: [`Pixel build ${build} carrier settings`, `${build} carrier settings`],
					description: `Android carrier settings added, removed and changed in Pixel build ${build} (${release}), for every carrier and every Pixel it ships to.`,
				}
			: {
					titles: [`Pixel build ${build} modems`, `${build} modems`],
					description: `The modem firmware in Pixel build ${build} (${release}) for each Pixel.`,
				},
	modem: (build, _release, modem, names) => {
		const phones = names?.phones ?? modem;
		return {
			titles: [
				`${phones} modem firmware in ${build}`,
				`${phones} modem (${build})`,
				`${build} ${modem} modem`,
			],
			description: `The modem firmware the ${phones} runs in Pixel build ${build}, and the configuration it loads whatever the carrier, decoded.`,
			terms: [],
		};
	},
};
