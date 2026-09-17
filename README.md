# carrier-explode
Easily explore and parse Apple's carrier bundle server.

## Why
While being nosy on some odd behavior for Indian carriers on iOS, I found there wasn't a good way to explore carrier bundles on web. There are many great tools to parse them already, but no one has quite made a live web explorer for carrier bundles. Here it is!

## What it does
Two sources, merged:

- **The iOS image.** A scheduled Action pulls the latest IPSW, extracts
  `/System/Library/Carrier Bundles` and `/System/Library/CountryBundles`, and
  puts them in R2. This is what a phone actually boots with, and it covers every
  country (~225) and ~690 carriers.
- **Apple's asset server.** One unauthenticated 6 MB plist lists every bundle
  Apple has pushed over the air. It fills in what the image can't: bundles
  updated since that iOS build, every older version, Watch bundles, and carriers
  that aren't in the image.

Each bundle shows which one it came from. Where both have it, the newer build
wins, same as on the phone. Everything is fetched and decoded by the worker.

- Every carrier and country, with version history.
- A cross-country table of the 3GPP cell broadcast message IDs and which alerts
  you can't turn off.
- MCC+MNC lookup, with MVNOs split out by ICCID prefix and SIM GID1/GID2.
- Diff any two bundles on any file they share.
- Right-click a setting to see what everyone else puts in that key.

Decoded: binary and XML plists, the `.der.pri` / `.der.gri` baseband overrides,
`.strings`, `.mobileconfig`, PEM certs, the OMA-DM tree, `bundle.metadata`, and
the CgBI status-bar logos (converted back to real PNG so a browser will show
them).

### The `.der.pri` format
It's DER — an outer `SET` of `[0]` elements, each wrapping a `SEQUENCE` of
Apple-private high-tag-number fields. The fields are positional pairs (path tag,
then value tag), so it reads as a flat stream, not a tree.

- `9fa711`/`9fa712`, `9fae70`/`9fae71`, `9fa70e`/`9fa70f` — name/value pairs.
- `9fa70c`/`9fa70d`, `9f98808080808080a70c`/`9fa70d` — Qualcomm EFS/NV path and
  the value written to it.
- `9fae72`/`9fae73` — `%u:dyn_cps.*` dynamic config. `%qu[N]:` means an N-byte
  NUL-padded string.
- `9f83e439`..`9f83e43f`, `9f83e442` — the eight 25-byte Carrier Configuration
  Management bitfields. Named by matching them against the plaintext `.pri`
  plists that a few dozen bundles still ship.
- `9fa708` — legacy NV item list, uint16 LE.
- `9fa709` — `MAVZ` + uint32-LE length + a zlib stream, or a raw NUL-separated
  list. It's a schema index, not actual overrides — no values attached — so it's
  shown on its own.

Values of 8 bytes or fewer are little-endian ints, unless the field says it's a
string or the bytes read as a word or a dotted version. Tags nobody has worked
out yet are dumped raw instead of hidden.

## Prior Art
- [dwilliamsuk/ios-carrier-bundles](https://github.com/dwilliamsuk/ios-carrier-bundles)
  — the IPSW extraction workflow here is his, lightly adapted to publish to R2
  instead of committing to a repo. It's the reason this site covers every
  country and not just the 29 on the asset server.
- [mast3rz3ro/imobilecfbm](https://github.com/mast3rz3ro/imobilecfbm) — actively
  maintained downloader/repacker/installer with its own bundle database. Best
  reference for the install side.
- [mrlnc/ipcc-downloader](https://github.com/mrlnc/ipcc-downloader) — archived
  Python bulk fetcher over the same manifest. Its README is where the
  carrier-vs-country distinction is written down, including that the EU-Alert
  cell broadcast config lives in country bundles. That's the pointer that makes
  the CBS data findable at all.
- [samsam123.name.my/ipcc](https://samsam123.name.my/ipcc/) — existing web
  downloader over the same XML. Fetch-only, no decoding.
- [theapplewiki.com — Carrier Bundle](https://theapplewiki.com/wiki/Carrier_Bundle)
  — on-device paths, the `defaults write` that lets Finder sideload an unsigned
  `.ipcc`, and the MCC+MNC symlink convention.
- 3GPP TS 23.041 for the cell broadcast message ID table (4382 is the
  operator-defined one), TS 31.102 for the SIM-side `EF_CBMI` / `EF_CBMID` /
  `EF_CBMIR` filter.
- [nickvsnetworking.com — Cell Broadcast in LTE](https://nickvsnetworking.com/cell-broadcast-in-lte/)
  for what those message IDs actually do on the network.

## Development
Svelte 5 + Vite on the front, a Cloudflare Worker on the back, `fflate` for ZIP
and zlib. Nothing else at runtime — the plist, DER and PNG decoders are all in
`worker/lib`.

```sh
pnpm install
pnpm dev      # vite + worker on :5173
pnpm test     # ~460 cases against real bundle fixtures
pnpm check    # tsc -b and svelte-check
pnpm deploy   # build + wrangler deploy
```

`.github/workflows/system-bundles.yml` refreshes the R2 bucket weekly (or on
demand, with `force` to redo the current build). It needs `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` secrets. Local dev reads the real bucket.

Caching is layered so nothing hits Apple per pageview: the manifest is parsed
down to its indexes once per warm isolate and held 6h, decoded responses go
through the Cache API, and `.ipcc` fetches use `cf: { cacheTtl, cacheEverything }`
so each file is pulled once and then served from the edge for 30 days. Bundle
URLs are content-addressed, so a decode never goes stale. The Cache API is a
no-op on `*.workers.dev`, hence the custom domain.

## Known gaps
- Carrier bundles have no cell-broadcast alert schema at all, just throttling
  knobs. Country bundles are the only place it lives.
- Bitmask fields are decoded to bit positions. What the bits actually do isn't
  documented anywhere.
- The manifest is current, but individual carriers go stale — plenty of
  operators' newest bundle is years old.
