# carrier-explode v2: iOS + Android, extracted on Cloudflare Containers

Branch `rearch/containers-android`. This document is the contract every part is
built against. The shared types live in code, not here:

| Contract | File |
|---|---|
| Unified data model (Profile, Carrier, Release, Timeline) | `src/lib/schema/types.ts` |
| R2 layout v2 and its record shapes | `src/lib/storage/keys.ts` |
| Android decoded protobuf shapes | `src/lib/decode/android/types.ts` |
| Container job interface | `extractor/container/src/job.ts` |

Change a contract only together with every user of it, and say so in your report.

## Goals

1. Both platforms' carrier settings, decoded, normalised into one schema, and comparable: iOS vs Android, as well as version vs version.
2. One carrier page per real-world carrier, showing its iOS bundle(s) and Android canonical(s) side by side. One page per country.
3. All ingest moves off GitHub Actions to an extractor Worker driving Cloudflare Containers, parallel, scheduled by cron and runnable by hand.
4. New storage in a new bucket (`carrier-explode-v2`), content-addressed throughout.

## Data flow

```
 upstream                 extractor (Workflows + Containers)              R2 (carrier-explode-v2)           site Worker
 ───────────              ─────────────────────────────────              ───────────────────────          ───────────
 ipsw.me/AppleDB  ─plan─▶ ios.ipsw ×N (heavy) ─▶ ios.release ─┐           obj/ meta/  (artifacts)         reads index/,
 Apple OTA manifest ────▶ ios.ota-archive ────────────────────┼─normalize▶ norm/v1/   (Profiles)          norm/, obj/;
 IPSW modem members ────▶ ios.modems ─────────────────────────┤           releases/  feeds/               iOS OTA bytes not
 Pixel OTA list ─plan──▶ android.ota ×device ─▶ android.release ─┘           ─index─▶ index/  ─scan─▶ scan/  archived yet: Apple
```

## Layers of the model

1. **Artifact**: bytes as stored (`obj/<sha256>`). An iOS `.ipcc` (OTA original, or an image bundle re-zipped deterministically: sorted entries, fixed timestamps, deflate level 9), a Pixel `<canonical>.pb`, `carrier_list.pb`, a modem package.
2. **Native decode**: the platform decoder. iOS: `src/lib/decode` (existing). Android: `src/lib/decode/android`. These show everything the file says, in the file's own terms, with field docs: `fields.ts` for iOS, and for Android the CarrierConfigManager javadoc in `src/lib/decode/android/fields.ts`.
3. **Profile**: the platform mapper turns one artifact into a `Profile`: identity (SIM matchers, ISO), APNs, **concepts**, a flat `raw` map and `variants`. Mappers: `src/lib/schema/ios.ts`, `src/lib/schema/android.ts`.
4. **Concepts** (`src/lib/schema/concepts.ts`): the registry that makes platforms comparable. Each concept has an id, a group, a value type, and up to two read functions, one per platform, each returning a `ConceptValue` with the native keys it read (`because`) and a fidelity. Features (`src/lib/features.ts`: 5G, VoLTE, Wi-Fi calling...) become `state` concepts. Settings such as MMS size limits, 5G icon rules, SIP/IMS parameters, emergency numbers, roaming and tethering become typed concepts. A concept that only one platform expresses is still listed: the gap is information.
5. **Carrier**: SIM matchers link sources across platforms (`src/lib/schema/identity.ts`):
   - An iOS bundle and an Android canonical are linked when they share an exact `matcherKey`. A plain MCC+MNC links only to a plain MCC+MNC, and a GID1 rule only to the same GID1 rule.
   - Each source joins the carrier it shares the most matchers with. Ties and conflicts are resolved by `src/lib/schema/links.ts`, a hand-kept list of manual links and splits. Unmatched sources become their own carrier.
   - A carrier's `id` is internal (it never appears in a URL) and stays stable across index rebuilds.
6. **Android device lines**: a Pixel build ships different CarrierSettings per device generation, verified on CP3A.260905.009. Pixel 6, Fold, 9 and 10 Pro differ in 632 of 633 files, including VoLTE and Wi-Fi calling availability for over 100 carriers. Pixel 9 and 9 Pro Fold are identical, and `carrier_list.pb` is identical across devices. So every device is extracted, a release lists each source's distinct artifacts with the devices that carry them, and comparisons pick a device on each platform. This is the counterpart of iOS's per-phone override files.
7. **Country**: ISO code. iOS country bundles plus every carrier whose ISO matches.

## Repository layout (pnpm workspace)

```
apps/site                 SvelteKit worker (carrierexplode.com)
apps/extractor            extractor worker, Workflows, container image
packages/decode-ios       iOS decoder: .ipcc, plists, PRI, modem packages, Apple OTA manifest
packages/decode-android   Android decoder: CarrierSettings / CarrierList protobufs, CarrierConfig docs
packages/firmware         remote zip, payload.bin, ext4/EROFS readers (decoder-agnostic)
packages/schema           unified model, concepts, per-platform mappers, identity, compare, index builder
packages/storage          R2 v2 layout, record shapes, scan-index format (written by extractor, read by site)
packages/binary           byte helpers: hex/base64, LE/BE readers, sha256 (WebCrypto), streaming hash
packages/http             fetch with retries/backoff, Range reads, http↔https fallback for old Apple hosts
packages/tsconfig         shared strict tsconfig bases (lib, worker, svelte)
```

**One copy of everything.** Each piece of shared logic has exactly one home:

| Logic | Home | Consumers |
|---|---|---|
| Retrying fetch, Range requests, Apple host fallback | `http` | `firmware`, site (`fetchApple`), every extractor job |
| Byte reading, hex, sha256 | `binary` | both decoders, `firmware`, `storage`, extractor |
| Apple OTA manifest parsing | `decode-ios` | site (live freshness), `ios.ota-archive`, modem band-combo tags |
| Remote zip (IPSW, Pixel OTA) | `firmware` | `ios.modems`, `ios.ipsw`, `android.ota` |
| Timelines, carriers, countries, release summaries | `schema` (`buildIndexes`) | the extractor `index` job only. The site reads the result and never recomputes it. |
| Concept comparison, APN matching | `schema` (`compareProfiles`) | the site, and later the scan |
| R2 keys and the scan index format | `storage` | extractor (writes), site (reads) |
| Strict compiler settings | `tsconfig` | every package |

Every package's `package.json` declares its workspace deps (`"@carrier-explode/binary": "workspace:*"`), and its `exports` points at its `src/index.ts`. TypeScript is consumed as source, with no build step for internal packages: Vite, esbuild and vitest all resolve it. Under pnpm's strict linking, an undeclared import fails to resolve, so the dependency rules below are enforced by the package graph itself.

The dependency rules are enforced, not merely followed:

| Package | May import |
|---|---|
| `decode-ios`, `decode-android`, `firmware`, `storage` | each other: never. Plus no SvelteKit or Workers APIs. |
| `schema` | the only package that sees both decoders. Its platform-neutral core imports neither; `schema/ios/*` imports only `decode-ios`, and `schema/android/*` only `decode-android`. |
| `apps/*` | anything, through package entry points only. |

The packages are developed in `src/lib/{decode,decode/android,firmware,schema,storage}` until the move. Code imports across them only through their `index.ts` (or `storage/keys.ts`).

## Code quality bar

These rules are strict TypeScript, held to without exceptions:
- **Compiler settings:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- **Types:**
  - No `any`.
  - No `as` except at a validated boundary.
  - No `!` without an adjacent proof.
  - `unknown` plus valibot or narrowing for every external input.
  - Discriminated unions, not optional-field soup.
  - `readonly` public types.
  - `satisfies` for tables.
  - Explicit return types on exports.
  - `import type`.
- **Code hygiene:**
  - Small, single-purpose modules.
  - Pure functions by default.
  - No dead code, no commented-out code, no stray logging.
  - Errors are never swallowed silently.
- **Svelte:** Svelte 5 runes, with typed props. Platform differences live in a per-platform view registry, not in scattered conditionals.

## Module ownership (who writes what)

| Area | Paths | Owner |
|---|---|---|
| Android decoders, firmware readers, Android field docs, `android.*` jobs | `src/lib/decode/android/**`, `src/lib/firmware/**`, `tools/android-fields/**`, `extractor/container/src/jobs/android*.ts`, `test/android*.test.ts` | agent: android |
| Schema: concepts, mappers, identity, compare, timelines, index builder | `src/lib/schema/**` (except types.ts), `test/schema*.test.ts` | agent: schema |
| Extractor infra: Worker, Workflows, container classes, transport, runtime, Dockerfile, `ios.ota-archive`, `normalize`/`index`/`scan` job wrappers, local dev harness | `extractor/**` except `jobs/ios*` and `jobs/android*` | agent: extractor |
| iOS ingest jobs: plan, ipsw, release, modems (ports of `scripts/*.py` / `.sh`) | `extractor/container/src/jobs/ios*`, `extractor/container/src/jobs/ios/**` | agent: ios-ingest |
| Site: data layer, routes, components | `src/lib/server/**`, `src/routes/**`, `src/lib/components/**`, `src/lib/api/**`, root `wrangler.jsonc` | agent: site |

Rules for every agent:
- **Don't commit, push or switch branches.** The orchestrator commits.
- **Don't edit the root `package.json` or `pnpm-lock.yaml`.** List any dependency you need in your report. `extractor/` has its own `package.json`, and the extractor agent owns it.
- **Don't edit files another agent owns.** If you need something from another area, write against the contract and note it in your report.
- **Keep `src/lib/decode/**` and `src/lib/schema/**` free of SvelteKit and Workers imports.** They run in browsers, Workers and Node, which is how the container and the site share one copy of the logic.
- **Match the repo's style.** Dense doc comments that explain why, no filler, short names. Read a few existing files first.

## Function contracts between areas

```ts
// src/lib/decode/android/index.ts  (android)
export function decodeCarrierSettings(bytes: Uint8Array): CarrierSettings;
export function decodeMultiCarrierSettings(bytes: Uint8Array): MultiCarrierSettings;
export function decodeCarrierList(bytes: Uint8Array): CarrierList;
export function configDoc(key: string): { note: string; type?: string; since?: number; deprecated?: boolean } | undefined;

// src/lib/firmware/index.ts  (android; Node + Workers, fetch-based)
export function openRemoteZip(url: string, opts?): Promise<RemoteZip>;          // central directory over Range requests
export function openPayload(zip: RemoteZip): Promise<Payload>;                  // payload.bin manifest, partitions, ops
export function partitionReader(p: Payload, name: string): BlockReader;         // random access, op-granular cache
export function openExt4(r: BlockReader): Promise<Ext4>;                        // readdir/readFile by path

// src/lib/schema/*  (schema)
export function iosProfile(bundle: OpenedBundle, source: SourceRef, sha: string): Profile;               // ios.ts
export function androidProfile(cs: CarrierSettings, source: SourceRef, sha: string, list?: CarrierList): Profile; // android.ts
export function compareProfiles(a: Profile, b: Profile): ProfileComparison;                                  // compare.ts
export function buildIndexes(input: IndexInput): IndexOutput;                                                // index-build.ts
//   IndexInput: { releases: Release[]; otaRefs: OtaFile[]; profiles: (sha) => Profile | undefined; previous?: { sources: Record<string,string> } }
//   IndexOutput: { releases: ReleaseSummary[]; carriers: CarrierSummary[]; docs: CarrierDoc[]; countries: CountrySummary[]; sources: Record<string,string> }
export const CONCEPTS: ConceptDef[];                                                                         // concepts.ts
```

## Extractor

`extractor/` is its own Worker (`extractor/wrangler.jsonc`, `extractor/package.json`).

- **Worker:**
  - A `scheduled` handler that only creates Workflow instances.
  - Bearer-authed `POST /run {pipeline, params}`, `GET /runs/:id` and `GET /jobs/:id` for manual runs.
  - Handlers on `outboundByHost` for `r2.internal` and `control.internal`.
- **Pipelines (Workflows):**

  | Pipeline | Steps |
  |---|---|
  | `ios-images` | `ios.plan` → N× `ios.ipsw` → per build `ios.release` (calls `ios.modems`) → `normalize` → `index` → `scan` |
  | `ios-ota` | `ios.ota-archive` → `normalize` → `index`, every 30 min |
  | `android` | `android.plan` → per build, one `android.ota` per device → `android.release` per build → `normalize` → `index` → `scan` |
  | `reindex` | `normalize {all:true}` sharded → `index` → `scan` |
  | `index` | `index` alone |

  Fan-out is one container per job, keyed by job id. The Workflow starts the job, then `step.waitForEvent("done-<jobId>")`, which the `control.internal /done` handler sends. A timeout or a failure retries up to the step's limit.
- **Containers:**
  - One image, two classes: `HeavyExtractor` (standard-4) and `LightExtractor` (standard-1).
  - The container runs `runtime.ts`: an HTTP server on 8080 with `POST /run` taking a JobSpec, which answers at once and runs the job.
  - The job reports through `control.internal` and gets R2 through `r2.internal`. No credentials are in the container.
- **Local dev without Docker:**
  - `extractor/dev/` has a fake `r2.internal` + `control.internal` server backed by a directory.
  - `pnpm --dir extractor job <type> --params '{...}' --r2 ./.r2` runs any job in-process against it. This is how jobs are developed and tested here.
  - A seed script loads such a directory into local wrangler R2, so the site can run against it.

## Site

**The visual design and layout don't change. The URL model does, so it can be honest about platforms.**

- **Path shape:** `/<kind>/<platform>/<name>[/<line>]/<version>/<tab>`, where the line is a Pixel codename on Android, or a model on Apple's rare model-specific bundles (`iPhone7,1`). For example `/carriers/ios/Verizon_LTE/72.0/`, `/carriers/android/verizon_us/tokay/79000000034/settings`, `/carriers/ipados/Verizon_LTE/58.1/`, `/carriers/watchos/Vodafone_uk/…`, `/countries/ios/UnitedStates/…` and `/defaults/android/default/…`.
- **Platforms:** `ios`, `ipados`, `watchos` and `android`. Apple's iPad and Watch bundles are separate files with their own version lines, so they're platforms, not slug suffixes or a `/watch` section. Paths come from `sourcePath()` and are never assembled by hand.
- **Version identity:** each platform uses what it actually versions, measured on real data.
  - **Apple:** the bundle's own version (`/carriers/ios/Verizon_LTE/72.0/`). It's unique in 4,433 of 4,434 OTA groups.
  - **Android:** device + version (`/carriers/android/tmobile_us/tokay/79000000034/`). The version is a per-device counter: 479 of 1,544 (carrier, version) pairs differ by device within one build. Identical files on several Pixels share one canonical URL.
  - **Reused versions** are named by where they first appeared: `50.1@2022-04-12` (OTA day), `64.1@23a341` (first iOS build; a build, not an OS label, because labels repeat across betas), `79000000004@cp3a.260905.009`. The grammar is `versionSlug`/`parseVersionSlug`.
  - **Copies** (image or OTA) are where a version came from, listed on its page. They aren't separate URLs.
- **Lists:** `/carriers` lists every platform, with a filter, and `/carriers/<platform>` lists one platform. The two-pane explorer, bundle head, version strip, tabs and styling all stay as they are.
- **Cross-platform links:** pages are per source. The Carrier (an internal id) links a page to its counterparts on other platforms, through the bundle head and one "iOS and Android" Overview section.
- **Redirects:** every v1 URL (`/carriers/<Name>/<ios-x|ota-x|ota-x-iPad>/…`, `/countries/<Name>/…`, `/watch/<Name>/…`, `/raw/…`) gets a 301 from a single `handle` step before routing, driven by `index/legacy.json`, which the index job writes. The step matches the longest prefix and carries over the sub-path and query. An unknown v1 slug is a 404, never a guess. After that step, routing only knows v2. A table-driven test checks every v1 slug form.
- **Android versions** use the existing components: Settings, APNs, Files and Changes. Android uses the existing phone picker, generalised to Pixels.
- **Other pages:**
  - Compare lets both sides pick any platform.
  - Features adds a Pixel group to its phone picker.
  - "iOS builds" becomes "Builds", with an Android section.
  - The titlebar subtitle becomes "iOS and Android carrier settings".

**No shims.** That means no compatibility code for data that doesn't exist yet, no optional-just-in-case fields, and no special-casing one platform inside another's code path. The only legitimate "legacy" in the system is the redirect table. The Apple OTA fetch for unarchived files is a feature in its own right.
