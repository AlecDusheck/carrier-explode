import adapter from "@sveltejs/adapter-cloudflare";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { mdsvex } from "mdsvex";
import { defineConfig } from "vitest/config";
import { headingIds } from "./src/lib/wiki-headings.ts";

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      // Wiki articles (src/wiki/*.md) are markdown compiled to components.
      extensions: [".svelte", ".md"],
      preprocess: [vitePreprocess(), mdsvex({ extensions: [".md"], highlight: false, rehypePlugins: [headingIds] })],
      compilerOptions: { experimental: { async: true } },
      experimental: { remoteFunctions: true },
    }),
  ],
  // Workspace packages are TypeScript source: bundle them rather than leave them to Node at build time.
  ssr: { noExternal: [/^@carrier-explode\//] },
  test: { include: ["test/**/*.test.ts"] },
});
