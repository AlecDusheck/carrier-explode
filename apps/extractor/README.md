# extractor

The ingest Worker of carrier-explode v2. It runs a Workflow instance per unit of work, each job in a Cloudflare
Container, and is the only writer of the `carrier-explode-v2` bucket.

```
cron ─▶ feed check ─▶ Workflow instance per build / manifest ──▶ publish instance
                        │ step "start":  jobs/<id>.spec.json, then container.start({ envVars: { JOB_ID, R2_* } })   (retried while max_instances is reached)
                        │                container: runs the job, R2 over its S3 API, writes jobs/<id>.json, exits
                        ▼ step "result": jobs/<id>.json, polled each minute until the job's timeout
```

## Layout

| Path | What |
|---|---|
| `src/index.ts` | Worker entry: `fetch` (API), `scheduled` (cron), the Workflow and container classes |
| `src/jobs.ts` | Every job type's params and output (valibot), size, timeout, write and delete scopes. Shared by Worker and container. |
| `src/worker/` | Container classes, `runJob`, the pipeline and feed tables, feed checks, ids, API, cron, purge |
| `src/workflows/` | One Workflow class per pipeline, and the shared tail (`tail.ts`) |
| `src/feeds/` | What each feed's check fetches and plans |
| `container/` | The image (`Dockerfile`, context: the repository root), its esbuild bundle (`build.mjs`), the runtime (`src/runtime/`) and the jobs (`src/jobs/`) |
| `dev/` | A directory-backed R2 client, the `job` CLI and `seed` |
| `test/`, `container/test/` | vitest |

## Jobs

- **A container runs one job.** The Worker writes its spec to `jobs/<id>.spec.json` and starts it with `JOB_ID` and
  the bucket's S3 endpoint and key in `R2_*`. It writes `jobs/<id>.json` (its result) and exits; a SIGTERM records a
  failure first.
- **Ids** are `<instance>:<type>:<unit>[.r<n>]`, and name the job's container. A failed attempt retries under `.r1`,
  `.r2`: a fresh container.
- **Starting is idempotent.** A retried start step never restarts a job that has recorded a result.
- **A start past `max_instances` fails**, and the step retries it every minute for up to half a day.
- **Failures surface within a minute.** The result step sees a container that exited without a record. A job past
  its timeout is destroyed.
- **Scopes.** A job's R2 client writes only under `JOBS[type].writes` and deletes only under `JOBS[type].deletes`.
  `obj/` and `meta/` are written once: the first origin wins.
- **`publish` runs one at a time**: it always runs in the container named `publish`, and a start finds it busy
  while another publish runs. It skips when an index built since its request is already out.
- A build is released only when every IPSW or device job of it succeeded.

| Job | Size | Writes | Deletes |
|---|---|---|---|
| `ios.ipsw` | heavy | `staging/` | nothing |
| `ios.modems` | light | `obj/`, `meta/`, `decoded/` | nothing |
| `ios.release` | light | `obj/`, `meta/`, `releases/ios/` | `staging/` |
| `ios.ota` | light | `obj/`, `meta/` | nothing |
| `ios.modem-summaries` | light | `decoded/` | nothing |
| `android.ota`, `android.modem` | light | `obj/`, `meta/` | nothing |
| `android.release` | light | `releases/android/` | nothing |
| `normalize` | light | `norm/` | nothing |
| `publish` | light | `index/`, `scan/` | generations but the current and previous |

## Feeds and pipelines

Each feed is checked in the Worker on a cron: a fetch and a diff against the bucket (`src/feeds/`). The check lists
what it would extract, most wanted first, and keeps the first `window` of it running. An instance is named by what it
extracts (`android-build-CP3A_260905_009`), so nothing is started twice. A failed instance stays failed, and is
listed by the check, until a check with `rebuild` reruns it.

The IPSW and Pixel checks also write the devices their feeds list to D1 (`devices`, and their names as `labels`), and
request a publish when that changed anything: pages see devices, names and labels only through the index a publish
builds. A Pixel is released in the earlier of the month of its first build on the OTA page and its first security patch
on source.android.com's build numbers, which keep the builds Google drops from the OTA page; a check never moves a
release later. The Pixel check's result lists as `delisted` the held builds the OTA page no longer lists; their
releases stay.

| Pipeline | One instance per | Steps | Started by |
|---|---|---|---|
| `ios-build` | iOS build | `ios.ipsw` per IPSW and `ios.modems` → `ios.release` → `normalize` → publish | `ios-images`, hourly, window 1 |
| `android-build` | Pixel build | `android.ota` and `android.modem` per device → `android.release` → `normalize` → publish | `android`, every 10 min, window 2 |
| `ios-ota` | OTA manifest | `ios.ota` per 200 files → `files.json` → `normalize` → publish, when anything changed | `ios-ota`, every 10 min |
| `reindex` | run | `normalize` and `ios.modem-summaries` over every artifact, in N shards → publish | hand |
| `publish` | request | `publish` (index, then scan index) → purge the site and the API | the others, or hand |
| `labels` | week | a name from a web search and a model for each code nothing names → publish, when it named any | `LABELS_CRON`, or hand |

## Deploy

```sh
# once, from apps/extractor
pnpm wrangler r2 bucket create carrier-explode-v2
# a build's IPSW jobs stage under staging/ and its release deletes it; this sweeps what a failed build leaves
pnpm wrangler r2 bucket lifecycle add carrier-explode-v2 expire-staging staging/ --expire-days 7
pnpm wrangler secret put RUN_TOKEN              # any long random string
pnpm wrangler secret put R2_ACCESS_KEY_ID       # an R2 API token scoped to the bucket: its S3 key
pnpm wrangler secret put R2_SECRET_ACCESS_KEY
pnpm wrangler secret put PURGE_TOKEN            # the site's and the API's PURGE_TOKEN; without it, drop PURGE_ORIGINS from wrangler.jsonc

# builds the image (needs Docker; the build context is the repository root), pushes it, deploys the Worker
pnpm deploy
```

`wrangler deploy --containers-rollout=none` deploys the Worker alone. `test/tables.test.ts` checks the crons and
Workflows in `wrangler.jsonc` against `FEEDS` and `PIPELINES`.

## Run by hand

```sh
URL=https://carrier-explode-v2-extractor.<account>.workers.dev
AUTH="authorization: Bearer $RUN_TOKEN"

curl -H "$AUTH" -X POST $URL/run -d '{"run":"ios-images","options":{"version":"27.2"}}'
# → {"feed":"ios-images","started":["ios-build-24B83"],"live":[],"failed":[]}
curl -H "$AUTH" -X POST $URL/run -d '{"run":"publish"}'        # → {"started":"publish-20261004T120000-ab12cd"}
curl -H "$AUTH" $URL/runs/ios-build-24B83                       # Workflow status
curl -H "$AUTH" $URL/jobs/ios-build-24B83:ios.release:24B83     # job record
```

A feed takes its check's options, all optional: `ios-images` `{version, since, rebuild, betas}`, `ios-ota` `{}`,
`android` `{rebuild}`. `reindex` takes `{shards, force}`: forced, it rewrites every output written before it started, so a
retried shard resumes. `publish` takes `{force}`.

## Develop locally (no Docker)

```sh
pnpm install                     # at the repository root: one workspace, one lockfile
cd apps/extractor
pnpm job ios.ota --params '{"urls":["https://…/x.ipcc"]}'   # into apps/extractor/.r2 (--r2 DIR for another)
pnpm job normalize --params '{"shard":0,"of":1}'
pnpm job publish --params '{"requested":"2026-10-04T00:00:00.000Z"}'
pnpm seed                        # .r2 → the site's local R2 (apps/site/.wrangler/state)
pnpm test
pnpm check                       # tsc, Worker and Node configs
pnpm build                       # the container bundle, container/dist/main.mjs
```

`job` runs a job in-process with the real context and executor against a bucket in a directory, scopes included.
Behind an HTTP proxy, set `NODE_USE_ENV_PROXY=1`, and `NODE_EXTRA_CA_CERTS` if the proxy needs it.
