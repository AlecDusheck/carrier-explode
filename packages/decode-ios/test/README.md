# Tests

`pnpm test` runs each package's tests against its own `test/fixtures`; the site's
tests and its v2 fixture bucket (`apps/site/test/fixtures/v2`) read the .ipcc and
manifest fixtures here. A few corpus tests (decode-ios, decode-qualcomm, decode-android,
the site's scan test) also run when `CORPUS` points at a local directory laid out as:

    image/                  one extracted iOS image: System/Library/{Carrier Bundles,CountryBundles}, Firmware/*.bbfw
    prl/                    *.prl files pulled out of OTA bundles
    scan/                   one generation from the extractor's `scan` job (scan/<gen>/)
    bbcfg-manifest.json     reference listing for the whole-package bbfw test (optional)
    android/CarrierSettings/  one Pixel's product/etc/CarrierSettings/*.pb
    android/mbn/              one Pixel 1–5a's vendor rfs/msm/mpss/readonly/vendor/mbn (mcfg_sw/, mcfg_hw/)

    CORPUS=~/corpus pnpm test

The fixtures are altered copies, not Apple's or Qualcomm's files: values are
changed (integers, low bits of baseband values, PRL IDs with their CRCs),
signatures, digests and certificate signatures are replaced, and the modem
image slice keeps only its configuration images. Every format stays valid and
values that must agree within a file are kept in agreement, so expected values
in the tests are the altered ones. The corpus tests above run on real files.

`packages/firmware/test/fixtures/android/tree` holds two altered Pixel CarrierSettings
files (names and APN strings changed), which decode-android's tests also read;
`make-images.sh` beside it builds the ext4 and EROFS images from it.
