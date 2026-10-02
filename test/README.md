# Tests

`pnpm test` runs against the fixtures in `test/fixtures`. A few corpus tests also
run when `CORPUS` points at a local directory laid out as:

    image/                  one extracted iOS image: System/Library/{Carrier Bundles,CountryBundles}, Firmware/*.bbfw
    prl/                    *.prl files pulled out of OTA bundles
    scan/                   one generation from `scripts/scan_index.ts build` (scan/<gen>/)
    bbcfg-manifest.json     reference listing for the whole-package bbfw test (optional)

    CORPUS=~/corpus pnpm test

The fixtures are altered copies, not Apple's or Qualcomm's files: values are
changed (integers, low bits of baseband values, PRL IDs with their CRCs),
signatures, digests and certificate signatures are replaced, and the modem
image slice keeps only its configuration images. Every format stays valid and
values that must agree within a file are kept in agreement, so expected values
in the tests are the altered ones. The corpus tests above run on real files.
