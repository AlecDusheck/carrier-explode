/** Loads a .r2 directory into the site's local R2 (one `wrangler r2 bulk put --local`) and its index into the site's local D1: `pnpm --filter @carrier-explode/extractor seed [--r2 .r2] [--site ../site] [--persist-to DIR]`, into the bucket the site binds. */

import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { D1Database } from "@cloudflare/workers-types";
import * as v from "valibot";
import { getPlatformProxy, unstable_readConfig } from "wrangler";

import { INDEX_STATEMENTS, statementSchema } from "@carrier-explode/db";

const { values } = parseArgs({
  options: {
    r2: { type: "string", default: ".r2" },
    site: { type: "string", default: "../site" },
    "persist-to": { type: "string" },
  },
});

const root = resolve(values.r2);
const site = resolve(values.site);
const bucket = unstable_readConfig({ config: join(site, "wrangler.jsonc") }).r2_buckets[0]?.bucket_name;
if (bucket === undefined) throw new Error(`${site}/wrangler.jsonc binds no R2 bucket`);
const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));

const persistTo = values["persist-to"] ? ["--persist-to", resolve(values["persist-to"])] : [];

const DB_PACKAGE = fileURLToPath(new URL("../../../packages/db", import.meta.url));

/** `wrangler <args>` in `cwd`, so that directory's config is the one used. */
async function wranglerIn(cwd: string, args: readonly string[]): Promise<void> {
  const code = await new Promise<number | null>((done, fail) => {
    spawn(wrangler, args, { cwd, stdio: "inherit" }).on("error", fail).on("close", done);
  });
  if (code !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(" ")} exited ${code}`);
}

/** The site's local D1 migrated (packages/db holds the migrations), then the index the directory's statements hold. */
async function seedIndex(): Promise<number> {
  const state = values["persist-to"] ? resolve(values["persist-to"]) : join(site, ".wrangler", "state");
  await wranglerIn(DB_PACKAGE, ["d1", "migrations", "apply", "carrier-explode-v2", "--local", "--persist-to", state]);
  const statements = v.parse(v.array(statementSchema), JSON.parse(await readFile(join(root, INDEX_STATEMENTS), "utf8")));
  // The CLI's --persist-to keeps its state under v3/; the proxy's path names that directory itself.
  const persist = values["persist-to"] ? { path: join(resolve(values["persist-to"]), "v3") } : true;
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: join(site, "wrangler.jsonc"), persist });
  try {
    await proxy.env.DB.batch(statements.map((s) => proxy.env.DB.prepare(s.sql).bind(...s.params)));
  } finally {
    await proxy.dispose();
  }
  return statements.length;
}

/** Every object file under the directory. */
async function files(): Promise<Array<{ key: string; file: string }>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name !== INDEX_STATEMENTS)
    .map((e) => join(e.parentPath, e.name))
    .map((file) => ({ key: relative(root, file).split(sep).join("/"), file }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

const objects = await files();
const work = await mkdtemp(join(tmpdir(), "seed-"));
try {
  const list = join(work, "objects.json");
  await writeFile(list, JSON.stringify(objects));
  process.stderr.write(`${objects.length} objects → local ${bucket} (from ${site})\n`);
  await wranglerIn(site, ["r2", "bulk", "put", bucket, "--filename", list, "--local", ...persistTo]);
  process.stderr.write(`${await seedIndex()} index statements → local D1\n`);
} finally {
  await rm(work, { recursive: true, force: true });
}
