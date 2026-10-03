// Bundles the container's code (src/main.ts plus the shared src/lib it
// imports) into one ESM file, so the image carries no node_modules.
// Run from anywhere: paths resolve from this file.

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
  // Shared code under ../../src/lib resolves its packages (fflate) from the
  // extractor's own install: the repository root is not installed in the image.
  nodePaths: [here("../node_modules")],
  // CommonJS dependencies (seek-bzip) call require() for Node builtins; ESM output has none of its own.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  logLevel: "info",
});
