# tools

- [ftab/](ftab/) - parser for Apple C1/C1X modem firmware (`ftab.bin`: HWID table, LZFSE board blobs, code-image segments), in stdlib Python. Carrier `.der.pri`/`.der.gri` files are decoded by `packages/decode-ios/src/pri.ts`.
- [phone-drawings/](phone-drawings/) - the iPhone and Pixel drawings in `apps/site/src/lib/drawings/` (a Pixel by codename) and the outlines in `apps/site/static/phones/`, from shapes measured on Apple's and Google's own images. `pnpm --filter @carrier-explode/phone-drawings generate [--check]`.
- [version-marks/](version-marks/) - the iOS and Android version marks in `apps/site/static/ios/` and `apps/site/static/android/`, coloured after each release's own branding. `node tools/version-marks/generate.ts [--check]`.
- [android-fields/](android-fields/) - generates `packages/decode-android/src/fields.ts` from AOSP's CarrierConfigManager javadoc.
