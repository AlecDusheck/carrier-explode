import { readFile } from "node:fs/promises";

import { defineConfig } from "vitest/config";

export default defineConfig({
	// Files imported as modules, as wrangler's rules import them: a binary one (FUS's auth tables) as bytes, Markdown and text as a string.
	plugins: [
		{
			name: "data-modules",
			async load(id: string): Promise<string | undefined> {
				if (id.endsWith(".dat"))
					return `export default new Uint8Array(${JSON.stringify([...(await readFile(id))])});`;
				if (id.endsWith(".md") || id.endsWith(".txt"))
					return `export default ${JSON.stringify(await readFile(id, "utf8"))};`;
				return undefined;
			},
		},
	],
	test: {
		include: ["test/**/*.test.ts", "container/test/**/*.test.ts"],
		environment: "node",
	},
});
