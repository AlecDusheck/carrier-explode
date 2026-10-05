# carrier-explode

A web explorer for iOS carrier and country bundles, the baseband config that ships with them, and Pixel carrier settings: [carrierexplode.com](https://carrierexplode.com).

## What's in it
- Every carrier and country bundle, from two sources merged into one timeline:
  - iOS images, extracted daily by the extractor. They cover all ~225 countries and ~690 carriers.
  - Apple's OTA asset server, which adds newer builds, history, Watch bundles and carriers not in any image.
- Decoded plists, `.der.pri`/`.der.gri` baseband overrides, PRLs, signed profiles, certificates, CgBI logos and more. Each field is explained where it's understood, marked by confidence.
- Diffs between any two bundles or versions, and a per-version Changes tab.
- "What does everyone else put here?": right-click any setting to see its value across every bundle.
- The modem packages of every iOS build, one per modem family (Qualcomm, Intel, Apple C1) with the iPhones each serves: carrier policies, band combos, power tables, and what each bundle overrides.
- Cell broadcast IDs by country, MCC/MNC lookup, and a page for each iOS release.
- Pixel CarrierSettings for every device of every build, with its own Settings, APNs, Files and Changes.

## Layout
A pnpm workspace. Packages are TypeScript consumed as source, with no build step; `scripts/check-deps.ts` enforces the dependency rules.
- `apps/site`: the SvelteKit Worker. `src/lib/server/` is the only code that touches R2 or Apple; the Worker only reads R2.
- `apps/extractor`: the ingest Worker, its Workflows and its container image.
- `packages/decode-ios`, `packages/decode-android`: the decoders. Findings about each format live next to the code that reads it.
- `packages/schema`: the platform-neutral model, concepts, mappers, timelines and index builder.
- `packages/storage`, `packages/firmware`, `packages/http`, `packages/binary`: the R2 layout, firmware readers (remote zip, OTA payload, ext4/EROFS, AEA, LZFSE), fetch, and byte helpers.
- `packages/tsconfig`: the strict compiler settings everything extends.
- `tools/`: standalone research tools for firmware formats, each with its own README (see `tools/README.md`).

## Ingest
The extractor Worker (`apps/extractor`) fetches, decodes and indexes everything on Cloudflare Containers; see [apps/extractor/README.md](apps/extractor/README.md).

## Development
```sh
pnpm install
pnpm test          # every package and app; CORPUS=<dir> adds the corpus tests, see packages/decode-ios/test/README.md
pnpm check         # tsc / svelte-check everywhere, then the dependency rules
pnpm build         # the site and the extractor's container bundle
pnpm dev           # the site, against local R2 (fill it with the extractor's seed script)
```
Every push to `main` deploys.

## Prior art
- [dwilliamsuk/ios-carrier-bundles](https://github.com/dwilliamsuk/ios-carrier-bundles): the IPSW extraction steps.
- [mast3rz3ro/imobilecfbm](https://github.com/mast3rz3ro/imobilecfbm), [mrlnc/ipcc-downloader](https://github.com/mrlnc/ipcc-downloader), [samsam123.name.my/ipcc](https://samsam123.name.my/ipcc/): downloaders over the same manifest.
- [The Apple Wiki: Carrier Bundle](https://theapplewiki.com/wiki/Carrier_Bundle).
- [JohnBel/EfsTools](https://github.com/JohnBel/EfsTools) and [fenrir-naru/mbn_utils](https://github.com/fenrir-naru/mbn_utils) for Qualcomm EFS and NV names; 3GPP TS 23.041 and 3GPP2 C.S0016 for the spec-defined formats.
