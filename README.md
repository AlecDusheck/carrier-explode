# carrier-explode
Easily explore and parse Apple's carrier bundle server.

## Why
While being nosy on some odd behavior for Indian carriers on iOS, I found there wasn't a good way to explore carrier bundles on web. There are many great tools to parse them already, but no one has quite made a live web explorer for carrier bundles. Here it is!

## What it does
Everything comes from one unauthenticated ~6 MB XML plist, Apple's legacy iTunes
version manifest, which lists every carrier bundle it has ever published plus a
much smaller set of country bundles. The worker resolves that index, downloads
the `.ipcc` files, verifies them against the manifest digests, unpacks them and
decodes every member. Your browser never talks to Apple.

- 750 carriers, every published iOS version of each, plus the Watch bundles.
- The 29 published country bundles, the only place a cell-broadcast schema
  appears, with a cross-country comparison of the 3GPP message identifiers and
  which alerts the user cannot switch off.
- MCC+MNC lookup, including MVNO disambiguation by ICCID prefix and SIM
  GID1/GID2.
- Structural diff of any two bundles on any file they share.
- Right-click any setting to see what every other operator puts in that key.

Decoded: binary and XML plists, the binary `.der.pri` / `.der.gri` baseband
overrides, `.strings`, `.mobileconfig`, PEM certificates, the OMA-DM tree,
`bundle.metadata`, and the Apple CgBI status-bar logos, which are converted back
to standard PNG so a browser will render them.

### The `.der.pri` format
DER: an outer `SET` of context-primitive `[0]` elements, each wrapping a
`SEQUENCE` of Apple-private high-tag-number fields, in positional pairs (a path
tag followed by its value tag), so it parses as a flat leaf stream rather than a
nested tree.

- `9fa711`/`9fa712`, `9fae70`/`9fae71`, `9fa70e`/`9fa70f` — name/value pairs.
- `9fa70c`/`9fa70d`, `9f98808080808080a70c`/`9fa70d` — Qualcomm EFS/NV path and
  the value written to it.
- `9fae72`/`9fae73` — `%u:dyn_cps.*` dynamic config. A `%qu[N]:` path declares an
  N-byte NUL-padded string.
- `9f83e439`..`9f83e43f`, `9f83e442` — the eight 25-byte Carrier Configuration
  Management feature-group bitfields, named by correlating against the plaintext
  `.pri` plists a few dozen bundles still ship.
- `9fa708` — legacy NV item list, uint16 little-endian.
- `9fa709` — the NV path schema index: `MAVZ` + a uint32-LE length + a zlib
  stream, or a raw NUL-separated list. It is a schema index, **not** a list of
  assigned overrides, and carries no values, so it is shown separately.

Values of eight bytes or fewer are little-endian integers unless the field
declares a string type or the bytes read as a word or dotted version. Tags whose
meaning is not established are shown raw rather than dropped.

## Prior Art
- [mast3rz3ro/imobilecfbm](https://github.com/mast3rz3ro/imobilecfbm) — actively
  maintained downloader, repacker and installer, with a local bundle database.
  The best reference for the install side.
- [mrlnc/ipcc-downloader](https://github.com/mrlnc/ipcc-downloader) — archived
  Python bulk fetcher over the same manifest. Its README is where the
  carrier-bundle versus country-bundle distinction is documented, including that
  country bundles are what hold the EU-Alert cell broadcast config. That pointer
  is what makes the CBS data findable at all.
- [samsam123.name.my/ipcc](https://samsam123.name.my/ipcc/) — an existing web
  downloader over the same XML. Fetch-only; the gap it leaves is decoding.
- [theapplewiki.com — Carrier Bundle](https://theapplewiki.com/wiki/Carrier_Bundle)
  — format reference: on-device paths, the `defaults write` that lets Finder
  sideload an unsigned `.ipcc`, and the MCC+MNC symlink convention.
- 3GPP TS 23.041 for the cell-broadcast message identifier table (including 4382,
  operator-defined), TS 31.102 for the SIM-side `EF_CBMI` / `EF_CBMID` /
  `EF_CBMIR` filter.
- [nickvsnetworking.com — Cell Broadcast in LTE](https://nickvsnetworking.com/cell-broadcast-in-lte/)
  for what those message identifiers actually do on the network side.

## Development
Svelte 5 and Vite on the front, a Cloudflare Worker on the back, `fflate` for ZIP
and zlib. No other runtime dependencies; the plist, DER and PNG decoders are all
in `worker/lib`.

```sh
pnpm install
pnpm dev      # vite plus the worker, http://localhost:5173
pnpm test     # decoder suite, ~460 cases against real bundle fixtures
pnpm check    # tsc -b and svelte-check
pnpm deploy   # build and wrangler deploy
```

Caching is layered so nothing is fetched per pageview: the parsed manifest is
reduced to its indexes once per warm isolate and held for six hours, decoded
responses go through the Cache API, and upstream `.ipcc` fetches use
`cf: { cacheTtl, cacheEverything }` so each file is pulled from Apple once and
then served from the edge for 30 days. Bundle URLs are content-addressed, so a
decode never needs invalidating. Note the Cache API is a no-op on
`*.workers.dev`, which is why the deployment is bound to a custom domain.

## Known gaps
- Most countries have **no published country bundle** — India among them. Those
  ship inside the iOS system image at `/System/Library/Carrier Bundles/` and
  never reach the CDN, so an empty result here is the absence of a published
  bundle, not the absence of configuration.
- Carrier bundles carry no cell-broadcast alert schema, at most throttling knobs.
- Bit meanings inside bitmask fields are not published; decoded bit positions are
  shown, but not what each bit switches on.
- Staleness is per carrier, not per manifest. The manifest is current; an
  individual operator's newest bundle may be many years old.
