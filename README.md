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
- One timeline per bundle across iOS images and OTA builds, with a per-version
  changes view, and a page per iOS release listing what it added or changed.
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
SvelteKit on Cloudflare Workers, Svelte 5 with async `await` and remote
functions (both still experimental in Kit). `fflate` and `valibot` are the only
runtime dependencies; the plist, DER and PNG decoders are in `src/lib/server`.

```sh
pnpm install
pnpm dev      # reads the real R2 bucket
pnpm test     # ~470 cases against real bundle fixtures
pnpm check
pnpm deploy
```

- `src/lib/server/data.ts` is the only module that touches R2 or Apple.
  `timeline.ts` merges image and OTA bundles into one history per bundle.
- `src/lib/api/*.remote.ts` exposes that as `query` functions; components
  `await` them inside `<svelte:boundary>` panes.
- Every carrier, version, tab and file is a URL:
  `/carriers/ATT_US/ios-27.0/files/carrier.plist`, `/releases/24A437`.

R2 layout: `blobs/<sha1>.ipcc` (content-addressed, so a bundle unchanged across
iOS releases is stored once), `system/<build>/index.json` and `countries.json`,
and `system/builds.json`. `.github/workflows/system-bundles.yml` checks daily for
iOS releases it doesn't hold yet and extracts each one; run it with a `version`
to backfill older ones. It needs `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID`.

Caching: the manifest is parsed once per warm isolate and held 6h, expensive
tables go through the Cache API, and `.ipcc` fetches use `cf.cacheTtl` so each
file is pulled from Apple once. The Cache API is a no-op on `*.workers.dev`,
hence the custom domain.

Whole pages are cached too, by Workers Cache (`"cache"` in `wrangler.jsonc`),
which answers a hit before this worker runs at all — no CPU, no R2, no trip to
Apple — and collapses a burst on a cold URL into one render. It is the worker's
own cache, not the zone's: cache rules, page rules and Cache Everything do not
reach a response a worker returns, and the `Cache-Control` header is the whole
configuration surface. So `src/hooks.server.ts` puts one on every response: a day
for a page pinned to a version, ten minutes for one that tracks the newest
bundle, a minute for a 404, and `no-store` for errors, POSTs and remote calls —
without a header they would instead get RFC 9111 heuristic freshness, which is
how an error page ends up stuck in a cache. `max-age=0` throughout, so browsers
keep asking and a turned-over copy reaches them at once. Both lists opt out:
`/carriers` prefills its search box from the visitor's network and `/countries`
from where they are, so `guessCarrier()` and `guessCountry()` set
`locals.perVisitor` and neither page is ever shared.

Six hours is not arbitrary: the manifest behind those pages is memoised for six,
so a shorter page TTL buys freshness the data does not have. What cuts it short
is a purge — every cacheable response carries a `Cache-Tag` (`latest` or
`pinned`, plus `b-<bundle>`), and `POST /internal/purge` drops them for a shared
secret. `system-bundles.yml` calls it once every image in a run is in the bucket.
Set the secret in two places: `pnpm wrangler secret put PURGE_TOKEN`, and the
same value as a `PURGE_TOKEN` repository secret. Without the purge, pages simply age out.

The cache is keyed by path, query and worker version, so a deploy starts cold
and code changes need no purge. One cost to know about: with caching on,
requests that are normally free — static assets included — bill at the standard
Workers request rate.

Page weight: the carrier list is ~780 links, and rendering it server-side costs
twice — once as markup, once as the query result serialised for hydration. It is
the page on `/carriers` and `/countries`, so it stays there; on a bundle page it
is navigation, hidden in a closed drawer on a phone, so it is left out of the
render and fetched when something wants it. Crawlers still find every bundle
through `sitemap.xml` and the two list pages.

Search and preview: `src/lib/seo.ts` builds every page's title and description
from the route alone — no data fetch, so the head is right even when a pane
fails — and `src/routes/+layout.svelte` is the only place that renders them.
`/sitemap.xml` lists the bundle pages; `robots.txt` keeps crawlers out of `/raw`
and `/compare`, whose query strings are endless.

Rate limits: `src/hooks.server.ts` puts every request into one of four per-IP
budgets, sized to the work it can start rather than to the request. `scanKey`
gets 10/min — one scan opens up to 120 bundles and its cache key is built from
client-supplied strings, so misses are free to manufacture — `getDiff` 20/min,
anything that can unzip an `.ipcc` (`/raw`, the bundle queries, a page pinned to
a version) 60/min, and everything else 120/min. Counters are per Cloudflare
location and eventually consistent, so these are ceilings on one source
hammering, not accounting; a cached response never reaches the worker, so only
misses count. A missing binding or a request with no `cf-connecting-ip` fails
open, which is what `vite dev` does.

## Known gaps
- Carrier bundles have no cell-broadcast alert schema at all, just throttling
  knobs. Country bundles are the only place it lives.
- Bitmask fields are decoded to bit positions. What the bits actually do isn't
  documented anywhere.
- The manifest is current, but individual carriers go stale — plenty of
  operators' newest bundle is years old.
