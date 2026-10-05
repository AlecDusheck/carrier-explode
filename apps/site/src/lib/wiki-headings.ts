/** Heading anchors for wiki articles, the way GitHub makes them, so `/wiki/x#some-heading` links resolve. */

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] };

/** "overrides_*.plist and .der.pri" -> "overrides_plist-and-derpri". */
export const headingSlug = (text: string): string =>
  text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");

const textOf = (n: Node): string => n.value ?? (n.children ?? []).map(textOf).join("");

/** A rehype plugin (mdsvex `rehypePlugins`) giving every h2 and h3 an id. */
export function headingIds(): (tree: Node) => void {
  return (tree) => {
    const walk = (n: Node): void => {
      if (n.type === "element" && (n.tagName === "h2" || n.tagName === "h3")) {
        n.properties = { ...n.properties, id: headingSlug(textOf(n)) };
      }
      n.children?.forEach(walk);
    };
    walk(tree);
  };
}
