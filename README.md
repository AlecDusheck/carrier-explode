# carrier-explode

A web explorer for iOS carrier and country bundles, and the baseband config that ships with them: [carrierexplode.com](https://carrierexplode.com).

## What's in it
- Every carrier and country bundle, from two sources merged into one timeline:
  - iOS images, extracted daily by a workflow. They cover all ~225 countries and ~690 carriers.
  - Apple's OTA asset server, which adds newer builds, history, Watch bundles and carriers not in any image.
- Decoded plists, `.der.pri`/`.der.gri` baseband overrides, PRLs, signed profiles, certificates, CgBI logos and more. Each field is explained where it's understood, marked by confidence.
- Diffs between any two bundles or versions, and a per-version Changes tab.
- "What does everyone else put here?": right-click any setting to see its value across every bundle.
- The modem packages of every iOS build, one per modem family (Qualcomm, Intel, Apple C1) with the iPhones each serves: carrier policies, band combos, power tables, and what each bundle overrides.
- Cell broadcast IDs by country, MCC/MNC lookup, and a page for each iOS release.

## Layout
- `src/lib/decode/`: the decoder. It's self-contained (no SvelteKit or Workers imports, and `fflate` is its only dependency) and runs in browsers, Workers and Node. Findings about each format live next to the code that reads it.
- `src/lib/server/data.ts`: the only module that touches R2 or Apple. The Worker only reads from R2.
- `src/lib/api/*.remote.ts`: remote queries used by the pages.
- `scripts/`: ingest, run by the workflows.
- `tools/`: standalone research tools for firmware formats, each with its own README (see `tools/README.md`).

## Workflows
- `system-bundles.yml` (daily): extracts new iOS images, betas included, into R2, with the modem packages of every iPhone that received each build.
- `scan-index.yml` (after every system-bundles run, or on demand): builds the cross-bundle scan index from what's already stored.
- `baseband.yml` (manual): adds the modem packages no index names yet, for every held image and iPhone, pulling only those IPSW members over range requests; with `rebuild`, re-decodes every stored package after a decoder change.

They need `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. An optional `PURGE_TOKEN`, set both as a repository secret and as a Worker secret, makes new images appear immediately rather than when cached pages expire.

## Development
```sh
pnpm install
pnpm dev      # reads the real R2 bucket
pnpm test     # CORPUS=<dir> adds the corpus tests, see test/README.md
pnpm check
```
Every push to `main` deploys.

## Prior art
- [dwilliamsuk/ios-carrier-bundles](https://github.com/dwilliamsuk/ios-carrier-bundles): the IPSW extraction steps.
- [mast3rz3ro/imobilecfbm](https://github.com/mast3rz3ro/imobilecfbm), [mrlnc/ipcc-downloader](https://github.com/mrlnc/ipcc-downloader), [samsam123.name.my/ipcc](https://samsam123.name.my/ipcc/): downloaders over the same manifest.
- [The Apple Wiki: Carrier Bundle](https://theapplewiki.com/wiki/Carrier_Bundle).
- [JohnBel/EfsTools](https://github.com/JohnBel/EfsTools) and [fenrir-naru/mbn_utils](https://github.com/fenrir-naru/mbn_utils) for Qualcomm EFS and NV names; 3GPP TS 23.041 and 3GPP2 C.S0016 for the spec-defined formats.
