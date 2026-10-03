<script lang="ts">
  import { getRare, type getBundle } from "#lib/api/bundles.remote.ts";
  import { getBundleOverrides, getPlmn } from "#lib/api/tables.remote.ts";
  import { modemLabel } from "#lib/decode/index.ts";
  import { bundleArgs, bundleHref, humanBytes, link } from "#lib/format.ts";
  import { phoneList, phoneRows } from "#lib/phones.ts";
  import { asDict, selectionRules } from "#lib/settings.ts";
  import BundleChip from "./BundleChip.svelte";

  let { bundle }: { bundle: Awaited<ReturnType<typeof getBundle>> } = $props();

  const args = $derived(bundleArgs({ kind: bundle.kind, name: bundle.name, version: bundle.entry.slug }));
  const carrier = $derived(asDict(bundle.quick["carrier.plist"]));
  const info = $derived(asDict(bundle.quick["Info.plist"]));
  const version = $derived(asDict(bundle.quick["version.plist"]));
  const fromImage = $derived(bundle.entry.source === "image");
  const tab = (seg: string, q = "") => bundleHref(bundle.kind, bundle.name, bundle.entry.slug, seg) + q;
  const fileQuery = (path: string, copy?: string) => "?" + new URLSearchParams({ file: path, ...(copy ? { copy } : {}) });
</script>

<fieldset class="hgroup">
  <legend>Bundle</legend>
  <table class="grid fit">
    <tbody>
      {#if typeof carrier?.CarrierName === "string"}
        <tr>
          <td class="k">On the iPhone</td>
          <td>{[carrier.CarrierName, bundle.entry.build].filter(Boolean).join(" ")} <span class="dimtext">in Settings › General › About › Carrier</span></td>
        </tr>
      {/if}
      {#if bundle.info.bundleName !== bundle.name}<tr><td class="k">Bundle</td><td class="mono">{bundle.info.bundleName}</td></tr>{/if}
      <!-- The version strip above names the version; only a bundle without a build number needs its own. -->
      {#if !bundle.entry.build && info?.CFBundleVersion !== undefined}
        <tr><td class="k">CFBundleVersion</td><td class="mono">{String(info.CFBundleVersion)}</td></tr>
      {/if}
      {#if bundle.verified !== null}
        <tr>
          <td class="k">Digest</td>
          <td>
            {#if bundle.verified}<span class="chip good" title="{fromImage ? 'Content ID' : 'SHA-1'} matches the published digest">verified</span>
            {:else}<span class="chip bad">mismatch</span>{/if}
          </td>
        </tr>
      {/if}
      <tr><td class="k">Size</td><td>{humanBytes(bundle.downloadSize)} packed, {humanBytes(bundle.info.totalSize)} unpacked</td></tr>
    </tbody>
  </table>
  <details class="more">
    <summary>Digests and source</summary>
    <table class="grid">
      <tbody>
        <tr><td class="k">Content ID</td><td class="mono wrap">{bundle.contentId}</td></tr>
        <tr><td class="k">SHA-1</td><td class="mono wrap">{bundle.sha1}</td></tr>
        <tr><td class="k">SHA-384</td><td class="mono wrap">{bundle.sha384}</td></tr>
        {#if version}
          <tr><td class="k">version.plist</td><td class="mono wrap">{Object.entries(version).map(([k, v]) => k + "=" + String(v)).join("  ")}</td></tr>
        {/if}
      </tbody>
    </table>
  </details>
  {#if bundle.entry.url}
    <div class="rowflex gap-above"><a class="btn" href={bundle.entry.url} rel="noreferrer" download>Download .ipcc</a></div>
  {/if}
</fieldset>

{#if bundle.kind === "carriers"}
  {@const rules = selectionRules(await getPlmn(), bundle.name)}
  <fieldset class="hgroup">
    <legend>Selected by ({rules.length})</legend>
    {#if rules.length}
      <p class="dimtext note">
        The SIMs Apple's manifest sends to this bundle. An MVNO rule is checked before the plain MCC-MNC entry.
        {#if rules.some((r) => r.via === "ICCID")}An ICCID rule takes every SIM card numbered from its prefix.{/if}
      </p>
      <table class="grid">
        <thead><tr><th>By</th><th>Value</th><th>Which SIMs</th></tr></thead>
        <tbody>
          {#each rules as r, i (i)}
            <tr><td>{r.via}</td><td class="mono">{r.key}</td><td>{r.match ?? ""}</td></tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="dimtext note">No SIM is sent here by the manifest; another bundle's MVNO configuration or an older iOS picks it.</p>
    {/if}
  </fieldset>
{/if}

{#if bundle.related.country}
  <fieldset class="hgroup">
    <legend>Country</legend>
    <BundleChip kind="countries" name={bundle.related.country} cc={bundle.cc} />
  </fieldset>
{/if}

{#if bundle.related.carriers.length}
  <fieldset class="hgroup" id="carriers">
    <legend>Carriers ({bundle.related.carriers.length})</legend>
    {#each bundle.related.carriers as name (name)}
      <BundleChip kind="carriers" {name} />
    {/each}
  </fieldset>
{/if}

{#if carrier}
  {@const rare = await getRare(args)}
  <fieldset class="hgroup">
    <legend>Unique to this bundle{rare.indexed ? ` (${rare.rows.length})` : ""}</legend>
    {#if !rare.indexed}
      <p class="dimtext note">
        {rare.why === "old" ? "Only each bundle's newest version is compared across bundles." : "Not computed yet: the next index run compares every bundle."}
      </p>
    {:else if !rare.rows.length}
      <p class="dimtext note">Nothing in carrier.plist that at most three other bundles share.</p>
    {:else}
      <p class="dimtext note">carrier.plist settings at most three other {bundle.kind === "countries" ? "country bundles" : "bundles"} share.</p>
      <table class="grid">
        <thead><tr><th>Setting</th><th>Value</th><th>Also in</th></tr></thead>
        <tbody>
          {#each rare.rows as r (r.path + (r.value ?? ""))}
            <tr>
              <td class="mono wrap"><a href={tab("settings", "?filter=" + encodeURIComponent(r.path.split(/[.[]/, 1)[0]))}>{r.path}</a></td>
              <td class="mono wrap">{r.value ?? "set"}</td>
              <td>{#each r.with as w (w)}<BundleChip kind={bundle.kind} name={w} />{:else}<span class="dimtext">none</span>{/each}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </fieldset>
{/if}

{#if bundle.kind !== "countries"}
  {@const ov = await getBundleOverrides(args)}
  {@const rows = phoneRows(bundle.entry, bundle.info.files, ov).filter((r) => r.phones.length)}
  {#if rows.length || ov?.defaults.length}
    <fieldset class="hgroup">
      <legend>Phones</legend>
      <table class="grid">
        <thead><tr><th>Phones</th><th>Modem</th><th>Overrides</th></tr></thead>
        <tbody>
          {#each rows as r (r.slug + r.path)}
            <tr>
              <td>{phoneList(r.phones)}</td>
              <td>
                {#each [...new Set(r.phones.map((p) => p.family).filter((f): f is string => !!f))] as f, i (f)}{#if i}, {/if}<a href={link(`/builds/${ov?.build}/${f}`)}>{modemLabel(f)}</a>{/each}
              </td>
              <td>
                <a href={tab("settings", fileQuery(r.path, r.copy))}>Settings</a> · <a href={tab("modem", fileQuery(r.path, r.copy))}>Modem</a>
                {#if r.copy}<span class="dimtext">from build {r.build}</span>{/if}
              </td>
            </tr>
          {/each}
          {#if ov?.defaults.length}
            <tr><td>{phoneList(ov.defaults)}</td><td></td><td class="dimtext">None: carrier.plist and the modem's defaults</td></tr>
          {/if}
        </tbody>
      </table>
    </fieldset>
  {/if}
{/if}
