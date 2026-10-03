<script lang="ts">
  import { getBundle, getIndex } from "#lib/api/bundles.remote.ts";
  import { getPlmn } from "#lib/api/tables.remote.ts";
  import { humanBytes, link, verArgs } from "#lib/format.ts";
  import { asDict, selectionRules } from "#lib/settings.ts";
  import type { TabProps } from "#lib/types.ts";
  import Copies from "../../Copies.svelte";
  import PlatformPair from "../../PlatformPair.svelte";
  import Rare from "../../Rare.svelte";
  import SourceChip from "../../SourceChip.svelte";

  let { at }: TabProps = $props();

  const bundle = $derived(await getBundle(verArgs(at)));
  const carrier = $derived(asDict(bundle.quick["carrier.plist"]));
  const info = $derived(asDict(bundle.quick["Info.plist"]));
  const version = $derived(asDict(bundle.quick["version.plist"]));
</script>

<fieldset class="hgroup">
  <legend>Bundle</legend>
  <table class="grid fit">
    <tbody>
      {#if typeof carrier?.CarrierName === "string"}
        <tr>
          <td class="k">On the device</td>
          <td>{carrier.CarrierName} {bundle.entry.version} <span class="dimtext">in Settings › General › About › Carrier</span></td>
        </tr>
      {/if}
      {#if bundle.info.bundleName !== at.ref.name}<tr><td class="k">Bundle</td><td class="mono">{bundle.info.bundleName}</td></tr>{/if}
      {#if !bundle.entry.version && info?.CFBundleVersion !== undefined}
        <tr><td class="k">CFBundleVersion</td><td class="mono">{String(info.CFBundleVersion)}</td></tr>
      {/if}
      {#if bundle.verified !== null}
        <tr>
          <td class="k">Digest</td>
          <td>{#if bundle.verified}<span class="chip good" title="Matches the digest it is listed under">verified</span>{:else}<span class="chip bad">mismatch</span>{/if}</td>
        </tr>
      {/if}
      <tr><td class="k">Size</td><td>{humanBytes(bundle.downloadSize)} packed, {humanBytes(bundle.info.totalSize)} unpacked</td></tr>
    </tbody>
  </table>
  <details class="more">
    <summary>Digests</summary>
    <table class="grid">
      <tbody>
        <tr><td class="k">Content ID</td><td class="mono wrap">{bundle.contentId}</td></tr>
        <tr><td class="k">SHA-256</td><td class="mono wrap">{bundle.sha256}</td></tr>
        <tr><td class="k">SHA-1</td><td class="mono wrap">{bundle.sha1}</td></tr>
        {#if version}
          <tr><td class="k">version.plist</td><td class="mono wrap">{Object.entries(version).map(([k, v]) => k + "=" + String(v)).join("  ")}</td></tr>
        {/if}
      </tbody>
    </table>
  </details>
</fieldset>

<Copies entry={bundle.entry} />

{#if at.ref.kind === "carrier"}
  {@const rules = selectionRules(await getPlmn(), at.ref.name)}
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

{#if bundle.home}
  <fieldset class="hgroup">
    <legend>Country</legend>
    <SourceChip source={bundle.home} />
  </fieldset>
{/if}

{#if at.ref.kind === "country"}
  {@const carriers = (await getIndex()).carrier.filter((c) => c.cc !== undefined && c.cc === bundle.cc)}
  {#if carriers.length}
    <fieldset class="hgroup" id="carriers">
      <legend>Carriers ({carriers.length})</legend>
      {#each carriers as c (c.path)}<a class="chip bundle" href={link(c.path)}>{c.name}</a>{/each}
    </fieldset>
  {/if}
{/if}

<PlatformPair {at} />

{#if carrier}<Rare {at} file="carrier.plist" />{/if}
