<script lang="ts">
  import { api, humanBytes, type IndexPayload, type StatsPayload } from "./api.ts";

  let { index }: { index: IndexPayload } = $props();
  let stats = $state<StatsPayload | null>(null);

  $effect(() => { api.stats().then((s) => (stats = s)).catch(() => {}); });
</script>

<div class="scroll pad">
  <h2 style="margin-top:0">What this is</h2>
  <p class="lead">
    Apple publishes a carrier bundle for every operator it has ever shipped a configuration for, and a
    country bundle for a much smaller set of countries. Both are plain ZIPs on a public CDN, listed in one
    unauthenticated XML manifest. This site enumerates all of them and decodes what is inside, including
    the binary .der.pri baseband overrides that other tooling downloads but does not read.
  </p>

  <fieldset class="hgroup">
    <legend>Manifest</legend>
    <table class="grid">
      <tbody>
        <tr><td class="k">Source</td><td class="mono wrap"><a href={index.manifestUrl} rel="noreferrer">{index.manifestUrl}</a></td></tr>
        <tr><td class="k">Size</td><td>{humanBytes(index.manifestBytes)}, XML plist, no authentication</td></tr>
        <tr><td class="k">Fetched</td><td class="mono">{index.fetchedAt}</td></tr>
        <tr><td class="k">iTunes version</td><td class="mono">{index.iTunesVersion}</td></tr>
        {#if stats}
          <tr><td class="k">Newest iOS key</td><td class="mono">{stats.newestOSVersion}</td></tr>
          <tr><td class="k">Published bundle references</td><td class="num">{stats.versionRefs}</td></tr>
        {/if}
      </tbody>
    </table>
  </fieldset>

  <fieldset class="hgroup">
    <legend>Counts</legend>
    <table class="grid">
      <tbody>
        {#each Object.entries(index.counts) as [k, v] (k)}
          <tr><td class="k mono">{k}</td><td class="num">{v}</td></tr>
        {/each}
      </tbody>
    </table>
  </fieldset>

  {#if stats}
    <fieldset class="hgroup">
      <legend>Carriers per country ({stats.countriesCovered})</legend>
      <div>
        {#each stats.byCountry as c (c.cc)}
          <span class="chip" title={c.name ?? c.cc}>{c.cc.toUpperCase()} {c.n}</span>
        {/each}
      </div>
    </fieldset>
  {/if}

  <fieldset class="hgroup">
    <legend>Known gaps</legend>
    <ul class="lead" style="margin:0; padding-left:1.2em">
      <li>
        Most countries have no published country bundle. The CDN carries only the handful listed under
        Countries; India, for one, is absent. Every other country's cell-broadcast configuration ships
        inside the iOS system image at <span class="mono">/System/Library/Carrier Bundles/</span>, which
        means pulling an IPSW and mounting the root filesystem. Nothing here can show it, and an empty
        result for a country is the absence of a published bundle, not the absence of configuration.
      </li>
      <li>
        Carrier bundles contain no cell-broadcast alert schema, at most throttling and validity knobs. The
        country bundle is the only artefact that says which alerts a handset will surface.
      </li>
      <li>
        Some private ASN.1 tags in the .der.pri are unidentified. They are shown raw rather than dropped.
        The named ones were pinned by correlating against the plaintext .pri plists that a few dozen
        bundles still ship.
      </li>
      <li>
        Bit meanings inside bitmask fields are not published. Decoded bit positions are shown; what each
        bit switches on is not known.
      </li>
      <li>
        Staleness is per carrier, not per manifest. The manifest itself is current, carrying bundles with
        minimum-OS values in the 26.x and 27.x range, but an individual operator's newest bundle may be
        many years old.
      </li>
    </ul>
  </fieldset>

  <fieldset class="hgroup">
    <legend>Format notes</legend>
    <ul class="lead" style="margin:0; padding-left:1.2em">
      <li>
        An .ipcc is a plain ZIP: <span class="mono">Payload/&lt;Name&gt;.bundle/</span> with carrier.plist,
        Info.plist, version.plist, per-device <span class="mono">overrides_&lt;MODELS&gt;.plist</span> and
        <span class="mono">.der.pri</span>, signatures, localisations, and sometimes a mobileconfig, a CDMA
        PRL or an OMA-DM tree.
      </li>
      <li>
        A .der.pri is DER: an outer SET of context-primitive [0] elements, each wrapping a SEQUENCE of
        Apple-private high-tag-number fields. Fields come in positional pairs, a path tag followed by its
        value tag, so it parses as a flat leaf stream rather than a nested tree.
      </li>
      <li>
        The MAVZ blob, and its uncompressed equivalent, is a schema index of NV paths the format knows
        about. It is not a list of assigned overrides and carries no values, so it is kept separate from
        the settings the bundle actually writes.
      </li>
      <li>
        The eight 25-byte feature-group bitfields map onto the named arrays visible in the plaintext .pri
        files: CDMA 1X, EVDO, System Determination, Call Manager, Wireless Messaging, Data Service, UIM
        Service and OMA. A ninth group appears in some bundles under a tag with no plaintext counterpart
        and is labelled by tag.
      </li>
      <li>
        Values of eight bytes or fewer are little-endian integers unless they read as a word or a dotted
        version. Larger values are NUL-padded ASCII, an entire XML document (Qualcomm's policyman rules
        engine, complete with Perforce changelist IDs), or opaque bytes shown as hex.
      </li>
    </ul>
  </fieldset>

  <fieldset class="hgroup">
    <legend>Caching</legend>
    <p class="lead" style="margin:0">
      Your browser never talks to Apple. The worker pulls the manifest at most every six hours and keeps
      the derived index in isolate memory; bundle downloads go through the Cloudflare edge cache with a
      30-day TTL, and every decoded response is stored in the Cache API and served with a long
      Cache-Control. Bundle URLs are content-addressed, so a decode never needs invalidating.
    </p>
  </fieldset>

  <fieldset class="hgroup">
    <legend>References</legend>
    <ul style="margin:0; padding-left:1.2em">
      <li><a href="https://github.com/mast3rz3ro/imobilecfbm" rel="noreferrer">mast3rz3ro/imobilecfbm</a>, a maintained download, repack and install utility.</li>
      <li><a href="https://github.com/mrlnc/ipcc-downloader" rel="noreferrer">mrlnc/ipcc-downloader</a>, an archived bulk fetcher whose README documents the carrier versus country distinction.</li>
      <li><a href="https://theapplewiki.com/wiki/Carrier_Bundle" rel="noreferrer">theapplewiki.com, Carrier Bundle</a>, for on-device paths and the MCC+MNC symlink convention.</li>
      <li>3GPP TS 23.041, cell broadcast architecture and the message identifier table including 4382.</li>
      <li>3GPP TS 31.102, EF_CBMI / EF_CBMID / EF_CBMIR, the SIM-side message identifier filter.</li>
    </ul>
  </fieldset>
</div>
