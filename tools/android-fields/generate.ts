/**
 * Regenerates src/lib/decode/android/fields.ts: every carrier config key AOSP
 * declares, with its javadoc, type, AOSP default, and the API level that
 * added it.
 *
 *   NODE_USE_ENV_PROXY=1 node tools/android-fields/generate.ts [--out <file>]
 *
 * Sources (SOURCES): CarrierConfigManager.java with its nested classes (Ims,
 * ImsVoice, ImsWfc, Gps, Apn...), plus the QNS and IWLAN services' own config
 * classes, which own the `qns.*` and `iwlan.*` keys real files use. Gitiles
 * serves raw files as base64 with ?format=TEXT. `since` comes from reading
 * CarrierConfigManager at each release tag in RELEASES.
 */

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { base64ToBytes } from "../../src/lib/binary/index.ts";
import type { ConfigDoc } from "../../src/lib/decode/android/index.ts";
import { fetchWithRetry } from "../../src/lib/http/index.ts";
import { typeBySetter, typeBySuffix } from "./config-type.ts";
import { parseConfigSource, type KeyConstant } from "./java.ts";

const GITILES = "https://android.googlesource.com";

interface Source {
  readonly repo: string;
  readonly ref: string;
  readonly path: string;
}

const CCM = { repo: "platform/frameworks/base", ref: "refs/heads/main", path: "telephony/java/android/telephony/CarrierConfigManager.java" } as const satisfies Source;

/** QNS's main branch is an empty tree (development moved out of AOSP); its newest tag still has the code. */
const SOURCES = [
  CCM,
  { repo: "platform/packages/services/QualifiedNetworksService", ref: "refs/tags/android-17.0.0_r1", path: "src/com/android/telephony/qns/QnsCarrierConfigManager.java" },
  { repo: "platform/packages/services/QualifiedNetworksService", ref: "refs/tags/android-17.0.0_r1", path: "src/com/android/telephony/qns/QnsCarrierAnspSupportConfig.java" },
  { repo: "platform/packages/services/Iwlan", ref: "refs/heads/main", path: "src/com/google/android/iwlan/IwlanCarrierConfig.java" },
] as const satisfies readonly Source[];

/** Release tags and their API levels, oldest first. */
const RELEASES = [
  ["android-10.0.0_r1", 29],
  ["android-11.0.0_r1", 30],
  ["android-12.0.0_r1", 31],
  ["android-12.1.0_r1", 32],
  ["android-13.0.0_r1", 33],
  ["android-14.0.0_r1", 34],
  ["android-15.0.0_r1", 35],
  ["android-16.0.0_r1", 36],
  ["android-17.0.0_r1", 37],
] as const satisfies ReadonlyArray<readonly [string, number]>;

const OLDEST_API = RELEASES[0][1];
const NEWEST_API = Math.max(...RELEASES.map(([, api]) => api));

const url = (s: Source): string => `${GITILES}/${s.repo}/+/${s.ref}/${s.path}?format=TEXT`;

async function fetchSource(s: Source): Promise<string> {
  const res = await fetchWithRetry(url(s));
  return new TextDecoder().decode(base64ToBytes((await res.text()).replace(/\s+/g, "")));
}

/** Top-level CarrierConfigManager constants are shown bare, as the SDK docs do. */
function displayConstant(constant: string): string {
  return constant.replace(/^CarrierConfigManager\./, "");
}

function docOf(k: KeyConstant, since: number | undefined): ConfigDoc {
  const type = typeBySuffix(k.key) ?? (k.setter === undefined ? undefined : typeBySetter(k.setter));
  return {
    note: k.text,
    constant: displayConstant(k.constant),
    ...(type === undefined ? {} : { type }),
    ...(since === undefined ? {} : { since }),
    ...(k.deprecated ? { deprecated: true } : {}),
    ...(k.hidden ? { hidden: true } : {}),
    ...(k.default === undefined ? {} : { default: k.default }),
  };
}

/**
 * One constant per key string. Renamed keys leave a deprecated alias with the
 * same string (`KEY_A = KEY_B`): the current name and its javadoc win.
 */
function dedupe(keys: readonly KeyConstant[]): KeyConstant[] {
  const byKey = new Map<string, KeyConstant>();
  for (const k of keys) {
    const seen = byKey.get(k.key);
    if (!seen || (seen.deprecated && !k.deprecated)) byKey.set(k.key, k);
  }
  return [...byKey.values()];
}

/** API level that first had each CarrierConfigManager key. */
async function firstSeen(): Promise<Map<string, number>> {
  const seen = new Map<string, number>();
  for (const [tag, api] of RELEASES) {
    const old = parseConfigSource(await fetchSource({ ...CCM, ref: `refs/tags/${tag}` }));
    for (const k of old.keys) if (!seen.has(k.key)) seen.set(k.key, api);
    process.stderr.write(`${tag}: ${old.keys.length} keys\n`);
  }
  return seen;
}

/**
 * Keys in no release tag are newer than the newest one: since = one past it.
 * Keys from the other services get no since: their tags do not line up with SDK levels.
 */
function sinceOf(key: string, fromCcm: boolean, seen: ReadonlyMap<string, number>): number | undefined {
  if (!fromCcm) return undefined;
  const api = seen.get(key) ?? NEWEST_API + 1;
  return api > OLDEST_API ? api : undefined;
}

function render(docs: ReadonlyArray<readonly [string, ConfigDoc]>): string {
  const lines = docs.map(([key, doc]) => `  ${JSON.stringify(key)}: ${JSON.stringify(doc)},`);
  return [
    "/**",
    " * GENERATED by tools/android-fields/generate.ts; do not edit. Sources:",
    ...SOURCES.map((s) => ` *   ${s.repo} ${s.ref} ${s.path}`),
    " * One entry per config key; ./docs.ts has the shape.",
    " */",
    "",
    'import type { ConfigDoc } from "./docs.ts";',
    "",
    "export const CONFIG_DOCS: Readonly<Record<string, ConfigDoc>> = {",
    ...lines,
    "};",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: "string", default: "src/lib/decode/android/fields.ts" } } });
  const all: Array<{ key: KeyConstant; fromCcm: boolean }> = [];
  for (const source of SOURCES) {
    const parsed = parseConfigSource(await fetchSource(source));
    if (parsed.skipped.length) throw new Error(`unevaluable constants in ${source.path}:\n${parsed.skipped.join("\n")}`);
    process.stderr.write(`${source.path}: ${parsed.keys.length} keys\n`);
    all.push(...parsed.keys.map((key) => ({ key, fromCcm: source === CCM })));
  }
  const ccmKeys = new Set(all.filter((k) => k.fromCcm).map((k) => k.key.key));
  const seen = await firstSeen();
  const docs = dedupe(all.map((k) => k.key))
    .map((k) => [k.key, docOf(k, sinceOf(k.key, ccmKeys.has(k.key), seen))] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  writeFileSync(values.out, render(docs));
  process.stderr.write(`${docs.length} keys -> ${values.out}\n`);
}

await main();
