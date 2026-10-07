/** What a Galaxy firmware's page is searched for: the carrier packs it added, removed or changed. */

import type { BuildSeo } from "#lib/seo.ts";

export const samsungBuildSeo: BuildSeo = {
	index: {
		title: "Galaxy firmware — carrier settings changes",
		description:
			"Every Galaxy firmware held, with the Samsung carrier packs (CSC) it added, removed or changed for each carrier.",
	},
	build: (build, release) => ({
		titles: [`Galaxy firmware ${build} carrier settings`, `${build} carrier settings`],
		description: `Samsung carrier packs (CSC) added, removed and changed in Galaxy firmware ${build} (${release}), for every carrier it ships.`,
	}),
	modem: (build, _release, modem) => ({
		titles: [`${build} ${modem}`],
		description: `Galaxy firmware ${build}.`,
		terms: [],
	}),
};
