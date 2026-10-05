/**
 * The workspace's dependency rules, from package.json and the imports alone:
 * every import is declared, every declared internal package is imported, no
 * import reaches into another package past its exports, and the package graph
 * keeps the shape ALLOWED and SCHEMA_PLATFORM_DIRS give it: decoders and firmware never import each other, only
 * schema sees the decoders, each of its platform directories its own, and values, which imports nothing, is everyone's; and the API
 * app reaches no decoder, as APP_BANNED says. Exits 1 on any violation.
 *
 *   node scripts/check-deps.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SCOPE = "@carrier-explode/";
const SKIP = new Set(["node_modules", "dist", ".svelte-kit", ".wrangler", ".r2"]);
const SOURCE = /\.(ts|mts|mjs|js|svelte)$/;

interface Manifest {
  readonly name: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, string>>;
}

interface Workspace {
  readonly dir: string;
  readonly manifest: Manifest;
}

/** Which internal packages each package may depend on; apps and tools may use any. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  binary: [],
  http: [],
  values: [],
  "decode-ios": ["binary", "values", "decode-qualcomm"],
  "decode-android": ["binary", "values"],
  "decode-qualcomm": ["binary", "values"],
  "decode-shannon": ["binary", "values", "sqlite"],
  "decode-mediatek": ["binary", "values"],
  sqlite: [],
  firmware: ["binary", "http"],
  schema: ["binary", "values", "decode-ios", "decode-android", "decode-qualcomm", "decode-shannon", "decode-mediatek"],
  storage: ["schema", "values"],
  db: ["binary", "schema"],
  tsconfig: [],
};

/** The only subpaths a package may import another through; storage sees schema's types and record schemas, never its mappers. */
const ONLY_SUBPATH: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  storage: { schema: ["./types", "./records"] },
};

/** Inside schema, each mapper sees its own decoders only, and the platform-neutral rest of src/ sees none. */
const DECODERS = ["decode-ios", "decode-android", "decode-qualcomm", "decode-shannon", "decode-mediatek"] as const;
const except = (...allowed: readonly (typeof DECODERS)[number][]): readonly string[] => DECODERS.filter((d) => !allowed.includes(d));
const SCHEMA_PLATFORM_DIRS: Readonly<Record<string, readonly string[]>> = {
  "src/ios": except("decode-ios", "decode-qualcomm"),
  "src/android": except("decode-android"),
  "src/modem/qualcomm": except("decode-qualcomm"),
  "src/modem/shannon": except("decode-shannon"),
  "src/modem/mediatek": except("decode-mediatek"),
};
const SCHEMA_CORE_BANNED: readonly string[] = DECODERS;

/** The packages an app may not import. The API serves the records the extractor decoded, so it never decodes, nor holds an artifact's bytes. */
const APP_BANNED: Readonly<Record<string, readonly string[]>> = {
  api: [...DECODERS, "firmware", "binary"],
};

const RUNTIME_ONLY = /^(?:\$app|\$env|cloudflare:|@cloudflare\/|@sveltejs\/|svelte(?:\/|$))/;

function isObject(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringRecord(v: unknown, what: string): Readonly<Record<string, string>> | undefined {
  if (v === undefined) return undefined;
  if (!isObject(v) || !Object.values(v).every((x) => typeof x === "string")) throw new Error(`${what}: not a string map`);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)]));
}

function readManifest(file: string): Manifest {
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isObject(raw) || typeof raw.name !== "string") throw new Error(`${file}: no name`);
  const exports = typeof raw.exports === "string" ? { ".": raw.exports } : stringRecord(raw.exports, `${file} exports`);
  const dependencies = stringRecord(raw.dependencies, `${file} dependencies`);
  const devDependencies = stringRecord(raw.devDependencies, `${file} devDependencies`);
  return {
    name: raw.name,
    ...(dependencies ? { dependencies } : {}),
    ...(devDependencies ? { devDependencies } : {}),
    ...(exports ? { exports } : {}),
  };
}

function workspaces(): Workspace[] {
  return ["apps", "packages", "tools"].flatMap((group) =>
    readdirSync(join(ROOT, group))
      .map((d) => join(ROOT, group, d))
      .filter((d) => existsSync(join(d, "package.json")))
      .map((dir) => ({ dir, manifest: readManifest(join(dir, "package.json")) })),
  );
}

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (SOURCE.test(name) && !name.endsWith(".d.ts")) yield path;
  }
}

/** Static imports and re-exports (a statement, so comments that mention `from "x"` do not count), and dynamic imports. */
const IMPORT = /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"'\n]+)["']|^\s*import\s*["']([^"'\n]+)["']|\bimport\(\s*["']([^"'\n]+)["']\s*\)/gm;

function importsOf(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(IMPORT)].flatMap(([, a, b, c]) => a ?? b ?? c ?? []);
}

/** `@scope/name` or `name` of a bare specifier, and the subpath after it (`.` for none). */
function splitSpecifier(spec: string): { readonly pkg: string; readonly subpath: string } {
  const parts = spec.split("/");
  const n = spec.startsWith("@") ? 2 : 1;
  const rest = parts.slice(n).join("/");
  return { pkg: parts.slice(0, n).join("/"), subpath: rest ? `./${rest}` : "." };
}

const isBuiltin = (spec: string): boolean => spec.startsWith("node:") || builtinModules.includes(splitSpecifier(spec).pkg);

const short = (name: string): string => (name.startsWith(SCOPE) ? name.slice(SCOPE.length) : name);

/** The decoders a schema source file may not import, by where it sits. */
function schemaBanned(rel: string): readonly string[] {
  if (!rel.startsWith("src" + sep)) return [];
  const dir = Object.keys(SCHEMA_PLATFORM_DIRS).find((d) => rel.startsWith(d + sep));
  return dir === undefined ? SCHEMA_CORE_BANNED : (SCHEMA_PLATFORM_DIRS[dir] ?? []);
}

function check(): string[] {
  const all = workspaces();
  const byName = new Map(all.map((w) => [w.manifest.name, w]));
  const problems: string[] = [];
  for (const w of all) {
    const me = short(w.manifest.name);
    const isPackage = w.dir.startsWith(join(ROOT, "packages") + sep);
    const declared = { ...w.manifest.dependencies, ...w.manifest.devDependencies };
    const allowed = ALLOWED[me];
    if (isPackage && allowed === undefined) problems.push(`${relative(ROOT, w.dir)}: no dependency rule for ${me}`);
    const used = new Set<string>();
    for (const file of sources(w.dir)) {
      const at = relative(ROOT, file);
      const rel = relative(w.dir, file);
      const inSrc = rel.startsWith("src" + sep);
      for (const spec of importsOf(file)) {
        if (spec.startsWith(".")) {
          const target = resolve(dirname(file), spec);
          if (!target.startsWith(w.dir + sep)) problems.push(`${at}: ${spec} leaves ${relative(ROOT, w.dir)}; import its package instead`);
          continue;
        }
        if (isPackage && inSrc && (isBuiltin(spec) || RUNTIME_ONLY.test(spec))) {
          problems.push(`${at}: ${spec}: packages run in browsers, Workers and Node, so they use no Node, SvelteKit or Workers APIs`);
          continue;
        }
        if (isBuiltin(spec) || spec.startsWith("#") || (!isPackage && RUNTIME_ONLY.test(spec))) continue;
        const { pkg, subpath } = splitSpecifier(spec);
        if (pkg === w.manifest.name) continue;
        used.add(pkg);
        if (!(pkg in declared)) problems.push(`${at}: imports ${pkg}, which ${w.manifest.name}'s package.json does not declare`);
        const target = byName.get(pkg);
        if (!target) continue;
        if (declared[pkg] !== undefined && declared[pkg] !== "workspace:*") problems.push(`${relative(ROOT, w.dir)}: ${pkg} is not declared as workspace:*`);
        if (!(subpath in (target.manifest.exports ?? {}))) problems.push(`${at}: ${spec} is not one of ${pkg}'s exports`);
        const only = ONLY_SUBPATH[me]?.[short(pkg)];
        if (only !== undefined && !only.includes(subpath)) problems.push(`${at}: ${me} may import ${pkg} through ${only.join(" or ")} only`);
        if (isPackage && inSrc) {
          if (allowed !== undefined && !allowed.includes(short(pkg))) problems.push(`${at}: ${me} may not import ${pkg}`);
          if (pkg in (w.manifest.devDependencies ?? {})) problems.push(`${at}: imports ${pkg} from src/, so it belongs in dependencies, not devDependencies`);
        }
        if (me === "schema" && schemaBanned(rel).includes(short(pkg))) problems.push(`${at}: this part of schema must not import ${pkg}`);
        if (!isPackage && APP_BANNED[me]?.includes(short(pkg))) problems.push(`${at}: ${me} may not import ${pkg}`);
      }
    }
    for (const dep of Object.keys(declared)) {
      if (dep.startsWith(SCOPE) && dep !== `${SCOPE}tsconfig` && !used.has(dep)) problems.push(`${relative(ROOT, w.dir)}: declares ${dep} but never imports it`);
    }
    if (isPackage && allowed !== undefined) {
      for (const dep of Object.keys(w.manifest.dependencies ?? {})) {
        if (dep.startsWith(SCOPE) && !allowed.includes(short(dep))) problems.push(`${relative(ROOT, w.dir)}: ${me} may not depend on ${dep}`);
      }
    }
  }
  return problems;
}

const problems = check();
for (const p of problems) process.stderr.write(`${p}\n`);
process.stdout.write(problems.length ? `${problems.length} dependency problem(s)\n` : "dependency rules hold\n");
process.exitCode = problems.length ? 1 : 0;
