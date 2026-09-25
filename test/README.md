# Tests

`pnpm test` runs against the fixtures in `test/fixtures`. A few corpus tests also
run when `CORPUS` points at a local directory laid out as:

    image/                  one extracted iOS image: System/Library/{Carrier Bundles,CountryBundles}, Firmware/*.bbfw
    prl/                    *.prl files pulled out of OTA bundles
    scan/                   one generation from `scripts/scan_index.ts build` (scan/<gen>/)
    bbcfg-manifest.json     reference listing for the whole-package bbfw test (optional)

    CORPUS=~/corpus pnpm test
