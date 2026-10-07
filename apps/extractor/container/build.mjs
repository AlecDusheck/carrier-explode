// The container's code and the workspace packages it imports, as one ESM file: the image carries no node_modules.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

await build({
	entryPoints: [here("./src/main.ts")],
	outfile: here("./dist/main.mjs"),
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	sourcemap: "linked",
	legalComments: "none",
	// CommonJS dependencies (seek-bzip) require() Node builtins, which ESM output lacks.
	banner: {
		js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
	},
	// A binary file imported as a module (FUS's auth tables), as the Worker's Data rule imports it.
	loader: { ".dat": "binary" },
	logLevel: "info",
});
