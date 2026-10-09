/**
 * Wiki articles: src/wiki/<section>/<slug>.md, or src/wiki/<slug>.md for one about the whole site, compiled by
 * mdsvex and served at /wiki/<path>. `searchTitle` is the page title, 52 characters at most.
 */

import type { Component } from "svelte";

interface Contributor {
	name: string;
	url?: string;
}

/** Who wrote the wiki, unless an article names its own. */
const CONTRIBUTORS: Contributor[] = [{ name: "Alec Dusheck", url: "https://dusheck.com" }];

/** A section per platform, each a directory of src/wiki, in the order the wiki lists them. */
const SECTIONS = [
	{
		id: "ios",
		title: "iOS",
		about: "iOS carrier bundles",
		intro:
			"Notes on iOS carrier bundles: what is in them, how iOS picks one, how they are delivered and signed, and what the modem files inside them do. Written from the bundles this site holds, and where a number can be read from them, read live.",
	},
	{
		id: "android",
		title: "Pixel",
		about: "Pixel carrier settings",
		intro:
			"Notes on Pixel carrier settings: the files in each build, how a SIM picks one, what they set, and where each modem keeps its own carrier configuration. Written from the Pixel builds this site holds and from AOSP.",
	},
	{
		id: "samsung",
		title: "Galaxy",
		about: "Galaxy carrier packs",
		intro:
			"Notes on Galaxy carrier settings: the carrier pack each sales code gets in a firmware, how a SIM picks one, where its IMS settings live, and the modem's own configurations. Written from the US Galaxy firmware this site holds.",
	},
	{
		id: "pipeline",
		title: "How it works",
		about: "how carrier-explode fetches, decodes, indexes and serves carrier settings",
		intro:
			"How this site gets its data: the feeds it checks, what it reads from each firmware and how, what it keeps, how it indexes it, and how the pages and the API read it. Written from the site's own code.",
	},
] as const satisfies readonly { id: string; title: string; about: string; intro: string }[];

type Section = (typeof SECTIONS)[number];

interface Frontmatter {
	title: string;
	searchTitle: string;
	description: string;
	/** YAML reads an unquoted date as a Date. */
	updated: string | Date;
	category?: "carrier";
	contributors?: Contributor[];
}

export interface Article extends Frontmatter {
	/** Under /wiki: `ios/der-pri`, or `credits` outside any section. */
	path: string;
	section: Section | null;
	/** YYYY-MM-DD. */
	updated: string;
	contributors: Contributor[];
	Body: Component;
}

const modules = import.meta.glob<{ default: Component; metadata: Frontmatter }>("/src/wiki/**/*.md", {
	eager: true,
});

function sectionOf(path: string): Section | null {
	const [dir, ...rest] = path.split("/");
	if (rest.length === 0) return null;
	const section = SECTIONS.find((s) => s.id === dir);
	if (!section || rest.length > 1) throw new Error(`src/wiki/${path}.md is not in a section's directory`);
	return section;
}

const ARTICLES: Article[] = Object.entries(modules)
	// oxlint-disable-next-line oxc/no-map-spread -- the frontmatter is the imported module's own object; assigning to it would change the module.
	.map(([file, m]) => {
		const path = file.slice("/src/wiki/".length, -".md".length);
		return {
			path,
			section: sectionOf(path),
			...m.metadata,
			updated: new Date(m.metadata.updated).toISOString().slice(0, 10),
			contributors: m.metadata.contributors ?? CONTRIBUTORS,
			Body: m.default,
		};
	})
	.toSorted((a, b) => a.title.localeCompare(b.title));

export const article = (path: string): Article | undefined => ARTICLES.find((a) => a.path === path);

/** Each section's general articles, and the per-carrier pages listed in a group of their own. */
export const SECTION_ARTICLES = SECTIONS.map((section) => {
	const own = ARTICLES.filter((a) => a.section === section);
	return {
		section,
		topics: own.filter((a) => !a.category),
		carriers: own.filter((a) => a.category === "carrier"),
	};
});

/** Articles about the whole site, in no section. */
export const SITE_ARTICLES = ARTICLES.filter((a) => a.section === null);
