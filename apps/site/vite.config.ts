import adapter from "@sveltejs/adapter-cloudflare";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { mdsvex } from "mdsvex";
import { defineConfig } from "vitest/config";
import { headingIds } from "./src/lib/wiki-headings.ts";

export default defineConfig(({ mode }) => ({
	plugins: [
		sveltekit({
			// `vite dev` binds the `dev` environment's remote D1 and R2; tests never reach them.
			adapter: adapter({ platformProxy: { environment: "dev", remoteBindings: mode !== "test" } }),
			// Wiki articles (src/wiki/*.md) are markdown compiled to components.
			extensions: [".svelte", ".md"],
			preprocess: [
				vitePreprocess(),
				mdsvex({ extensions: [".md"], highlight: false, rehypePlugins: [headingIds] }),
			],
			compilerOptions: { experimental: { async: true } },
			experimental: { remoteFunctions: true },
			// Root-absolute asset and link URLs: a page-relative one breaks wherever HTML is served at another depth.
			paths: { relative: false },
		}),
	],
	// Workspace packages are TypeScript source: bundle them rather than leave them to Node at build time.
	ssr: { noExternal: [/^@carrier-explode\//] },
	test: { include: ["test/**/*.test.ts"] },
}));
