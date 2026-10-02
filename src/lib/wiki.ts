/**
 * Wiki articles: src/wiki/<slug>.md, compiled by mdsvex. Frontmatter: `title` (the
 * heading), `searchTitle` (the page title, 52 characters at most), `description`,
 * `updated`, and `category: carrier` for a carrier's page. `contributors` is optional;
 * without it an article is credited to CONTRIBUTORS.
 */

import type { Component } from "svelte";

export interface Contributor {
  name: string;
  url?: string;
}

/** Who wrote the wiki, unless an article names its own. */
export const CONTRIBUTORS: Contributor[] = [{ name: "Alec Dusheck", url: "https://dusheck.com" }];

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
  slug: string;
  /** YYYY-MM-DD. */
  updated: string;
  contributors: Contributor[];
  Body: Component;
}

const modules = import.meta.glob<{ default: Component; metadata: Frontmatter }>("/src/wiki/*.md", { eager: true });

export const ARTICLES: Article[] = Object.entries(modules)
  .map(([path, m]) => ({
    slug: path.slice("/src/wiki/".length, -".md".length),
    ...m.metadata,
    updated: new Date(m.metadata.updated).toISOString().slice(0, 10),
    contributors: m.metadata.contributors ?? CONTRIBUTORS,
    Body: m.default,
  }))
  .sort((a, b) => a.title.localeCompare(b.title));

export const article = (slug: string) => ARTICLES.find((a) => a.slug === slug);

/** General articles, and the per-carrier pages the sidebar keeps in their own group. */
export const TOPICS = ARTICLES.filter((a) => !a.category);
export const CARRIERS = ARTICLES.filter((a) => a.category === "carrier");
