import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { headingSlug } from "../src/lib/wiki-headings.ts";

const DIR = "src/wiki";
const articles = new Map(
  readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => [f.slice(0, -3), readFileSync(`${DIR}/${f}`, "utf8")]),
);

/** The ids an article's headings get: their text as rendered, backticks dropped. */
const anchors = (md: string) =>
  new Set([...md.matchAll(/^#{2,3} (.+)$/gm)].map((m) => headingSlug(m[1].replace(/`/g, ""))));

describe("wiki", () => {
  it("links only to articles and headings that exist", () => {
    for (const [slug, md] of articles) {
      for (const [, target, hash] of md.matchAll(/\]\(\/wiki\/([^)#]+)(?:#([^)]+))?\)/g)) {
        expect(articles.has(target), `${slug} -> ${target}`).toBe(true);
        if (hash) expect(anchors(articles.get(target)!).has(hash), `${slug} -> ${target}#${hash}`).toBe(true);
      }
    }
  });
});
