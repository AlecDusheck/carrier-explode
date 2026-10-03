# extractor

The ingest side of carrier-explode v2: a Cloudflare Worker that runs pipelines as
Workflows, fans their work out to Cloudflare Containers, and is the only writer of
the `carrier-explode-v2` bucket. The site reads that bucket. The design is in
[docs/architecture-v2.md](../docs/architecture-v2.md).

```
cron / POST /run ──▶ Workflow (one per pipeline)
                       │ step.do: start job ─▶ HeavyExtractor / LightExtractor (one Durable Object + container per job)
                       │                         POST :8080/run  {id, type, params}
                       │                         container ──http://r2.internal──────▶ outbound handler ─▶ R2
                       │                                   ──http://control.internal─▶ /progress, /done
                       │ step.waitForEvent("done-<job>") ◀── /done writes jobs/<id>.json, sends the event
                       ▼ step.do: read jobs/<id>.json, validate the output, fan out the next jobs
```

## Layout

| Path | What |
|---|---|
| `src/index.ts` | Worker entry: `fetch` (API), `scheduled` (cron), Workflow and container classes, `ContainerProxy` |
| `src/jobs.ts` | Every job type's params and output (valibot schemas), sizes, timeouts and write scopes. Shared by Worker and container. |
| `src/protocol/` | `r2.internal` and `control.internal`, written against a `Store` port. The Worker, the dev harness and the tests all run this code. |
| `src/worker/` | Container classes, outbound handlers, the R2 `Store`, `runJob`, ids, API, cron, purge |
| `src/pipelines/` | One Workflow class per pipeline, plus the shared normalize, index, purge and scan tail |
| `src/fan-out.ts` | Concurrency-capped fan-out, used by both Workflows and jobs |
| `container/Dockerfile` | The image (build context: the repository root) |
| `container/build.mjs` | esbuild: `container/src/main.ts` and the shared `src/lib` it imports, bundled into one file |
| `container/src/runtime/` | HTTP server on 8080, JobContext, R2 and control clients, executor |
| `container/src/jobs/` | The registry (`index.ts`) and the jobs: `ota-archive/`, `normalize`, `build-index` (the `index` job), `scan`. iOS ingest is in `ios/`, Android in `android*.ts`. |
| `dev/` | Local harness: a directory-backed R2, the `job` CLI and `seed` |
| `test/` | vitest: the protocol handler, the runtime against the fake servers, refs bookkeeping, tables |

## Pipelines

| Pipeline | Steps | When |
|---|---|---|
| `ios-images` | `ios.plan` → `ios.ipsw` ×N (heavy) and `ios.modems` per build → `ios.release` per build → normalize → index → purge → scan | 05:17 UTC daily |
| `ios-ota` | `ios.ota-archive` → normalize (new shas) → index → purge → scan, but only when refs changed | every 30 min |
| `android` | `android.plan` → `android.ota` per device → `android.release` per build → normalize → index → purge → scan | 05:47 UTC daily |
| `reindex` | `normalize {all}` in N shards → index → purge → scan | by hand |
| `index` | `index` → purge | by hand |

A build is released only when every one of its IPSW or device jobs succeeded: a
partial merge would silently lose override files or devices. Failed jobs are retried
three times, each under a fresh id (`.r1`, `.r2`) and so a fresh container. When
anything failed, the run still publishes what succeeded and then ends errored, with
every failure in its error message.

Each pipeline's Workflow has `concurrency: 1`. Two runs of the same pipeline would
race on what they write (`refs.json`, releases), so a second run queues.

### Jobs

The params and output shapes are in `src/jobs.ts`. Write scopes are enforced by
`r2.internal`; reads are unrestricted.

| Job | Size | Writes |
|---|---|---|
| `ios.plan`, `android.plan` | light | nothing |
| `ios.ipsw` | heavy | `obj/`, `meta/` |
| `ios.modems` | light | `obj/`, `meta/`, `decoded/` |
| `ios.release` | light | `obj/`, `meta/`, `releases/ios/` |
| `ios.ota-archive` | light | `obj/`, `meta/`, `feeds/ios-ota/` |
| `android.ota` | light | `obj/`, `meta/` |
| `android.release` | light | `releases/android/` |
| `normalize` | light | `norm/` |
| `index` | light | `index/` |
| `scan` | light | `scan/` |

## Deploy

```sh
# once
pnpm wrangler r2 bucket create carrier-explode-v2
pnpm --dir extractor wrangler secret put RUN_TOKEN       # any long random string
pnpm --dir extractor wrangler secret put PURGE_TOKEN     # optional: the site's own PURGE_TOKEN

# every deploy: builds the image (needs a running Docker), pushes it, deploys the Worker
pnpm --dir extractor deploy
```

`wrangler deploy` builds `container/Dockerfile` with the repository root as context.
Without Docker, `wrangler deploy --containers-rollout=none` deploys the Worker and
leaves the containers as they were. `max_instances` in `wrangler.jsonc` must equal
`MAX_INSTANCES` in `src/worker/instances.ts`, and every cron there must equal a
`cron` in `src/worker/pipelines.ts`.

## Run by hand

```sh
URL=https://carrier-explode-extractor.<account>.workers.dev
AUTH="authorization: Bearer $RUN_TOKEN"

curl -H "$AUTH" -X POST $URL/run -d '{"pipeline":"ios-images","params":{"version":"27.2"}}'
# → {"id":"ios-images-20261003T120000-ab12cd","pipeline":"ios-images"}
curl -H "$AUTH" $URL/runs/ios-images-20261003T120000-ab12cd            # Workflow status, step outputs
curl -H "$AUTH" $URL/jobs/ios-images-20261003T120000-ab12cd:ios.plan:plan   # job record, or live progress
```

Each pipeline's params are its first job's (all optional): `ios-images` takes
`ios.plan`'s, `ios-ota` takes `{limit}`, and `android` takes `{rebuild}`. `reindex`
takes `{shards, force}` and `index` takes `{}`.

## Develop locally (no Docker)

```sh
pnpm --dir extractor install
pnpm --dir extractor job ios.ota-archive --params '{"limit":25}'   # into extractor/.r2
pnpm --dir extractor job normalize --params '{"all":true,"shard":0,"of":1}'
pnpm --dir extractor job index
pnpm --dir extractor job scan
pnpm --dir extractor seed        # .r2 → the site's local R2 (.wrangler/state at the repo root)
pnpm --dir extractor test
pnpm --dir extractor check       # tsc, Worker and Node configs
```

`job` runs the job in-process with the real runtime: the R2 and control clients,
context and executor. Those point at fake `r2.internal` and `control.internal`
servers that serve the same protocol code as the Worker, over a directory. Write
scoping is enforced too, so a job that passes here passes the same checks deployed.
The runtime reads its endpoints from `EXTRACTOR_R2_URL` and `EXTRACTOR_CONTROL_URL`.
Behind an HTTP proxy, set `NODE_USE_ENV_PROXY=1`, and `NODE_EXTRA_CA_CERTS` if the
proxy needs it.

## Limits to test on a real deploy

These are undocumented, or documented only loosely:

- **Outbound request body size.** Container → `r2.internal` requests are assumed to
  be capped like Worker requests (100 MB). Single PUTs stop at 96 MiB, and anything
  above 64 MiB goes multipart in 32 MiB parts (`src/protocol/limits.ts`). Measure,
  then raise the limits.
- **sleepAfter vs. outbound traffic.** Whether the container's own outbound requests
  count as activity is not documented. Every outbound call renews the timer
  (`checkIn`), the runtime heartbeats every 60 s, and `sleepAfter` is 30 min.
- **Outbound handler CPU/time.** Completing a multipart `obj/` upload re-hashes the
  object in the handler (`DigestStream`), since R2 verifies no digest for multipart
  objects. Very large objects may need `limits.cpu_ms`.
- **Events sent before `waitForEvent`.** A fast job can send `/done` before the
  Workflow reaches its wait step. The design assumes Workflows buffer the event, so
  confirm it.
- **Durable Object storage value size.** Each job's spec is stored in its Durable
  Object. normalize is chunked at 500 shas to stay well under the value limit.
- **Host restarts.** SIGTERM makes the runtime report the job as failed at once,
  so it is retried. The first `/done` wins, so a SIGTERM racing a real result
  cannot overwrite it.

## From the GitHub Actions workflows

| Old | New |
|---|---|
| `system-bundles.yml`, `system-bundles-build.yml` | `ios-images` (`ios.plan`, `ios.ipsw`, `ios.release`) |
| `baseband.yml` (fetch and index) | `ios.modems`, inside `ios-images` |
| `baseband.yml` (`rebuild`: re-decode every package) | none yet, see below |
| `scan-index.yml`, `scripts/scan_index.ts` | the `scan` job, at the end of every ingest pipeline. It is skipped when the heads have not moved. |
| `purge.yml` | the purge step after `index` (`PURGE_URL`, `PURGE_TOKEN`) |
| none (the OTA manifest was read live) | `ios-ota`: archives every OTA file into the bucket |
| none | `android` |

Once v2 is live, `.github/workflows/*.yml` and the `scripts/` they call can be
deleted. Nothing here depends on them.

Not ported: re-decoding every stored modem package after a `MODEM_SUMMARY_SCHEMA`
bump (baseband.yml `rebuild`). That would be a job over `meta/` of kind
`ios.bbfw` or `ios.ftab`, written to `decoded/`.
