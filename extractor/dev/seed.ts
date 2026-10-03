/**
 * Loads a .r2 directory (what `job` runs write) into the site's local R2, so
 * `pnpm dev` / `wrangler dev` at the repository root serves it:
 *
 *   pnpm --dir extractor seed [--r2 .r2] [--site ..] [--persist-to <dir>] [--bucket carrier-explode-v2]
 *
 * One `wrangler r2 bulk put --local` over every file: a wrangler
 * process per object would take minutes. Run from the site's directory, so
 * local state lands where the site's own wrangler looks (.wrangler/state).
 */

import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { BUCKET_V2 } from "../../src/lib/storage/keys.ts";

const { values } = parseArgs({
  options: {
    r2: { type: "string", default: ".r2" },
    site: { type: "string", default: ".." },
    "persist-to": { type: "string" },
    bucket: { type: "string", default: BUCKET_V2 },
  },
});

const root = resolve(values.r2);
const site = resolve(values.site);
const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));

/** Every object file under the directory, skipping multipart staging (.mpu) and temp files. */
async function files(): Promise<Array<{ key: string; file: string }>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !e.name.endsWith(".tmp"))
    .map((e) => join(e.parentPath, e.name))
    .map((file) => ({ key: relative(root, file).split(sep).join("/"), file }))
    .filter(({ key }) => !key.startsWith(".mpu/"))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

const objects = await files();
const work = await mkdtemp(join(tmpdir(), "seed-"));
try {
  const list = join(work, "objects.json");
  await writeFile(list, JSON.stringify(objects));
  const args = ["r2", "bulk", "put", values.bucket, "--filename", list, "--local", ...(values["persist-to"] ? ["--persist-to", resolve(values["persist-to"])] : [])];
  process.stderr.write(`${objects.length} objects → local ${values.bucket} (from ${site})\n`);
  const code = await new Promise<number | null>((done, fail) => {
    spawn(wrangler, args, { cwd: site, stdio: "inherit" }).on("error", fail).on("close", done);
  });
  if (code !== 0) throw new Error(`wrangler exited ${code}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
