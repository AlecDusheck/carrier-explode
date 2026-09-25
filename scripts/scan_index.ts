/**
 * Builds the cross-bundle scan index the worker reads (src/lib/server/keyscan.ts).
 * Works from what is already stored — image indexes and blobs in R2, OTA bundles
 * from Apple — so it never needs an IPSW. Run with vite-node (for `$lib`).
 *
 *   scan_index.ts plan  --builds builds.json --indexes DIR --out heads.json
 *       DIR holds <build>/index.json for every held image. Writes the
 *       head bundle of every carrier and country, and prints the blob ids needed.
 *   scan_index.ts build --heads heads.json --blobs DIR --cache DIR --out DIR [--gen G] [--previous G] [--heads-hash H]
 *       DIR/blobs holds <id>.ipcc; OTA bundles are fetched into --cache once.
 *       Writes scan/<gen>/… plus upload.json, and pointer.json for the caller
 *       to put at scan/current.json last. --heads-hash is recorded in the
 *       pointer so an unchanged head set is not rebuilt, unless a bundle failed:
 *       then the next run tries again.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { flattenBundle, openIpcc } from "$lib/decode";
import { MANIFEST_URL, manifestTables, parseManifest } from "$lib/server/manifest";
import { buildTimeline, headIndex, type ImageIndex } from "$lib/server/timeline";
import { POINTER_KEY, bundlesKey, fileDataKey, fileIndexKey, packShards, type ScanPointer } from "$lib/server/keyscan";

interface Head { kind: "carriers" | "countries"; name: string; src: string }

const { positionals, values: arg } = parseArgs({
  allowPositionals: true,
  options: {
    builds: { type: "string" }, indexes: { type: "string" }, heads: { type: "string" }, blobs: { type: "string" },
    cache: { type: "string" }, out: { type: "string" }, gen: { type: "string" }, previous: { type: "string" },
    "heads-hash": { type: "string" },
  },
});

/** A required option's value; exits with a usage error when it is missing. */
function required(name: keyof typeof arg): string {
  const v = arg[name];
  if (typeof v !== "string") {
    console.error(`${positionals[0]}: --${name} is required`);
    process.exit(2);
  }
  return v;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  // Old manifest entries are HTTP-only and some hosts have dropped HTTP; same fallback as the worker.
  const alt = url.startsWith("https:") ? "http:" + url.slice(6) : "https:" + url.slice(5);
  let last = "";
  for (const u of [url, alt]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(u, { headers: { "user-agent": "carrier-explode/1.0" } });
        if (res.ok) return new Uint8Array(await res.arrayBuffer());
        last = `HTTP ${res.status}`;
        if (res.status < 500) break;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
      }
    }
  }
  throw new Error(`${url}: ${last}`);
}

/** Image indexes in builds.json order (newest first), which is what buildTimeline expects. */
function readIndexes(buildsFile: string, dir: string): ImageIndex[] {
  const order: Array<{ build: string }> = JSON.parse(readFileSync(buildsFile, "utf8"));
  return order
    .map((b) => join(dir, b.build, "index.json"))
    .filter((p) => existsSync(p))
    .map((p): ImageIndex => JSON.parse(readFileSync(p, "utf8")));
}

async function plan() {
  const opt = { builds: required("builds"), indexes: required("indexes"), out: required("out") };
  const images = readIndexes(opt.builds, opt.indexes);
  const { index, refs } = manifestTables(parseManifest(await fetchBytes(MANIFEST_URL)));

  const names = {
    carriers: new Set([...index.carriers.map((c) => c.name), ...images.flatMap((i) => Object.keys(i.carriers))]),
    countries: new Set([
      ...index.countries.filter((c) => c.family === "iPhone").map((c) => c.id),
      ...images.flatMap((i) => Object.keys(i.countries)),
    ]),
  };
  const heads: Head[] = [];
  for (const kind of ["carriers", "countries"] as const) {
    for (const name of [...names[kind]].sort()) {
      const t = buildTimeline(kind, name, images, Object.hasOwn(refs, name) ? refs[name] : [], index.countries);
      const head = t[headIndex(t)];
      if (head) heads.push({ kind, name, src: head.src });
    }
  }
  writeFileSync(opt.out, JSON.stringify(heads));
  // stdout: blob ids for the caller to fetch from R2.
  for (const h of heads) if (h.src.startsWith("blob:")) console.log(h.src.slice(5));
  console.error(`${heads.length} heads, ${heads.filter((h) => h.src.startsWith("blob:")).length} from images`);
}

/** Signature hash lists and localisations are never worth scanning across bundles. */
const scannable = (flat: ReturnType<typeof flattenBundle>) =>
  Object.fromEntries(Object.entries(flat).filter(([f]) => !f.startsWith("signatures/") && !f.includes(".lproj/")));

async function build() {
  const opt = { heads: required("heads"), blobs: required("blobs"), cache: required("cache"), out: required("out") };
  const heads: Head[] = JSON.parse(readFileSync(opt.heads, "utf8"));
  const out = resolve(opt.out);
  const gen = arg.gen ?? new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
  mkdirSync(opt.cache, { recursive: true });

  const load = async (src: string): Promise<Uint8Array> => {
    if (src.startsWith("blob:")) return new Uint8Array(readFileSync(join(opt.blobs, `${src.slice(5)}.ipcc`)));
    // Apple URLs are immutable; keep each one across runs.
    const cached = join(opt.cache, createHash("sha1").update(src).digest("hex") + ".ipcc");
    if (existsSync(cached)) return new Uint8Array(readFileSync(cached));
    const bytes = await fetchBytes(src);
    writeFileSync(cached, bytes);
    return bytes;
  };

  const flats: Array<{ src: string; flat: ReturnType<typeof flattenBundle> }> = [];
  const failed: string[] = [];
  const queue = [...new Set(heads.map((h) => h.src))];
  await Promise.all(Array.from({ length: 12 }, async () => {
    for (let src = queue.shift(); src; src = queue.shift()) {
      try {
        flats.push({ src, flat: scannable(flattenBundle(openIpcc(await load(src)))) });
      } catch (e) {
        failed.push(src);
        console.error(`skip ${src}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }));
  flats.sort((a, b) => a.src.localeCompare(b.src));

  const objects: Array<{ key: string; body: string | Uint8Array }> = [
    { key: bundlesKey(gen), body: JSON.stringify({ srcs: flats.map((f) => f.src) }) },
  ];
  for (const [file, { index, data }] of packShards(flats)) {
    objects.push({ key: fileIndexKey(gen, file), body: JSON.stringify(index) });
    objects.push({ key: fileDataKey(gen, file), body: data });
  }
  // Every key this generation owns, so a later run can delete it in one pass.
  const keysKey = `scan/${gen}/_keys.json`;
  objects.push({ key: keysKey, body: JSON.stringify([...objects.map((o) => o.key), keysKey]) });

  for (const o of objects) {
    const p = join(out, o.key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, o.body);
  }
  writeFileSync(join(out, "upload.json"), JSON.stringify(objects.map((o) => ({ key: o.key, file: join(out, o.key) }))));
  const headsHash = arg["heads-hash"];
  const pointer: ScanPointer = {
    gen, builtAt: new Date().toISOString(), bundles: flats.length,
    ...(arg.previous ? { previous: arg.previous } : {}),
    // A partial index must not look complete to the next run's change check.
    ...(headsHash && !failed.length ? { heads: headsHash } : {}),
  };
  writeFileSync(join(out, "pointer.json"), JSON.stringify(pointer));
  console.error(`${gen}: ${flats.length} bundles, ${objects.length} objects, ${failed.length} failed; pointer → ${POINTER_KEY}`);
  if (failed.length > heads.length / 10) process.exit(1);
}

const cmd = positionals[0];
if (cmd === "plan") await plan();
else if (cmd === "build") await build();
else {
  console.error("usage: scan_index.ts plan|build …");
  process.exit(2);
}
