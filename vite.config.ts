import adapter from "@sveltejs/adapter-cloudflare";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      preprocess: vitePreprocess(),
      compilerOptions: { experimental: { async: true } },
      experimental: { remoteFunctions: true },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
