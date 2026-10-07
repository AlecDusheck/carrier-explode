# extractor

The ingest Worker (docs/architecture.md). Feed checks plan units from R2 key listings and start one Workflow instance per
unit; each unit extracts to the `carrier-explode-ingest` bucket and its last step queues its records on the index queue,
whose consumer writes D1 (`carrier-explode-index`) one message at a time and queues a purge of the readers' caches whenever it wrote.

| Path                                                | What                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                      | Entry: `fetch` (`http.ts`: /run, /runs), `scheduled` (`runs.ts`: feed checks), `queue` (`queues.ts`: index and purge), the Workflow and Durable Object classes         |
| `src/{apple,pixel,galaxy}/`                         | One family each: its feed check (`check.ts`), what it plans (`plan.ts`), its unit steps and its Workflows (`workflows.ts`)                                             |
| `src/unit.ts`                                       | The unit Workflow base and step retry policy; `workflows.ts`, the labels and reindex Workflows                                                                         |
| `src/dataset/`                                      | The daily dataset Workflow: the API's answers and AOSP XML in one zip (`build.ts`), its README and LICENSE                                                             |
| `src/runs.ts`, `pipelines.ts`, `scope.ts`, `env.ts` | Instance ids and starts, the pipeline table, the ingest scope, the bindings                                                                                            |
| `src/indexing.ts`, `records.ts`, `queues.ts`        | Indexing a unit's records into D1, the queues' consumers, purging                                                                                                      |
| `src/normalize.ts`, `store.ts`, `modem/`            | What each artifact kind normalizes to, the bucket as units use it, the modem readers Pixel and Galaxy share                                                            |
| `container/`                                        | The container's job server (`src/main.ts`), one entry per job in `src/jobs/index.ts`; it reaches the bucket through the Extractor object (`src/container-protocol.ts`) |

## Environments

`wrangler.jsonc` declares two, each with all its own bindings, vars and triggers:

- `dev`: one phone a family, its newest build (no cutover), no crons, and no AI binding, so no labels Workflow
  (`/run {"run":"labels"}` answers 404). Its own bucket, index and queues (`-dev`); run locally, or deployed to workers.dev
  to measure real limits.
- `production`: the full scope, the real bucket and index, crons.

## Run locally

Containers need Docker's socket where wrangler looks for it; without it every container step fails with only
`internal error; reference = …`. With Docker Desktop:

```sh
export DOCKER_HOST=unix://$HOME/.docker/run/docker.sock
```

`wrangler dev` does not apply the container's `instance_type` (vCPU, memory, disk), so a local run does not show whether a job fits them. It runs
the queues' consumers, but not their `max_concurrency`.

```sh
cd apps/extractor
printf 'RUN_TOKEN=dev\n' > .dev.vars.dev
STATE=/some/scratch/dir
pnpm wrangler d1 migrations apply carrier-explode-index-dev --local --env dev --persist-to $STATE
pnpm wrangler dev --env dev --port 8811 --test-scheduled --persist-to $STATE   # add --enable-containers=false without Docker

AUTH='authorization: Bearer dev'
curl -H "$AUTH" -X POST localhost:8811/run -d '{"run":"pixel-device"}'                 # a feed check: {started, live, failed, waiting, planned}
curl -H "$AUTH" -X POST localhost:8811/run -d '{"run":"pixel-device","rebuild":true}'  # restarts its failed units
curl -H "$AUTH" -X POST localhost:8811/run -d '{"run":"pixel-device","only":[]}'      # plans, starts nothing: `planned` lists every unit
curl -H "$AUTH" -X POST localhost:8811/run -d '{"run":"pixel-device","only":["pixel-device-CP3A_260905_009-frankel"]}'  # starts just that unit
curl -H "$AUTH" -X POST localhost:8811/run -d '{"run":"reindex","target":{"kind":"release","release":{"platform":"android","id":["CP3A.260905.009","frankel"]}}}'  # a new instance each time
curl -H "$AUTH" -X POST localhost:8811/run -d '{"run":"reindex","target":{"kind":"all","platform":"samsung"}}'  # normalizes what no norm/ object holds, then indexes every held record
curl -H "$AUTH" -X POST localhost:8811/run -d '{"run":"rederive","platform":"android"}'  # every source and change of a platform derived again
curl -H "$AUTH" localhost:8811/runs/pixel-device-CP3A_260905_009-frankel                         # an instance's status
curl "localhost:8811/__scheduled?cron=35+3+*+*+*"                                      # the daily checks, as cron fires them
pnpm wrangler d1 execute carrier-explode-index-dev --local --env dev --persist-to $STATE --command "SELECT * FROM releases"
curl localhost:8811/cdn-cgi/local/explorer/api/r2/buckets                              # the local bucket
```

## Deploy

Worker and Workflow names are account-wide: production's are `carrier-explode-<name>`, dev's `carrier-explode-<name>-dev`.

```sh
pnpm wrangler deploy --env dev --secrets-file <file with RUN_TOKEN=…>   # dev, on workers.dev
pnpm wrangler secret put RUN_TOKEN --env production   # and PURGE_TOKEN, with PURGE_ORIGINS, at the domain switch
pnpm deploy                                           # wrangler deploy --env production
```

## The iOS backfill

A check starts at most `CONTAINER_SHARE["ios-build"]` builds (production: 3 of the 4 containers) and none while that
many run; the `*/20 * * * *` cron checks again, so a slot that frees is taken within 20 minutes and the ~114 builds of
the backfill run back to back in about a day (at ~40 minutes a build), never more than 3 at once.

1. Deploy; to start at once rather than at the next cron, `POST /run {"run":"ios-build"}`. Its answer lists `started`,
   `live`, `waiting` (planned, no container free) and `failed`.
2. Watch `waiting` shrink in the cron's logs or by calling the same check; `GET /runs/<id>` follows one build.
3. A failed build stays failed until `POST /run {"run":"ios-build","rebuild":true}` restarts it (within the share).

## Test

```sh
pnpm test    # vitest: planning, step retries, starts, the queues' consumers, and indexing against a local D1 and R2
pnpm check   # tsc: the Worker, the container, the tests
```
