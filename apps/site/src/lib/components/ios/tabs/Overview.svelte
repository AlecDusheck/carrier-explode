<script lang="ts">
  import { getAppleBundle } from "#lib/api/apple.remote.ts";
  import { getCountryCarriers } from "#lib/api/sources.remote.ts";
  import { getSelectedBy } from "#lib/api/apple.remote.ts";
  import { humanBytes, verArgs } from "#lib/format.ts";
  import { asDict } from "#lib/apple/settings.ts";
  import { PLATFORM_DEVICES } from "#lib/platforms.ts";
  import type { TabProps } from "#lib/types.ts";
  import { sourceKey } from "@carrier-explode/schema/types";
  import Copies from "../../Copies.svelte";
  import Rare from "../../Rare.svelte";
  import SelectionTable from "../../SelectionTable.svelte";
  import SourceChip from "../../SourceChip.svelte";

  let { at }: TabProps = $props();

  const bundle = $derived(await getAppleBundle(verArgs(at)));
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
          <td class="k">On the {PLATFORM_DEVICES[at.ref.platform]}</td>
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
          <td>{#if bundle.verified}<span class="chip good" title="Matches the digest it is published under">verified</span>{:else}<span class="chip bad">mismatch</span>{/if}</td>
        </tr>
      {/if}
      <tr><td class="k">Size</td><td>{humanBytes(bundle.downloadSize)} packed, {humanBytes(bundle.info.totalSize)} unpacked</td></tr>
    </tbody>
  </table>
  <details class="more">
    <summary>Digests and source</summary>
    <table class="grid">
      <tbody>
        <tr><td class="k">Content ID</td><td class="mono">{bundle.contentId}</td></tr>
        <tr><td class="k">SHA-1</td><td class="mono">{bundle.digests.sha1}</td></tr>
        <tr><td class="k">SHA-384</td><td class="mono">{bundle.digests.sha384}</td></tr>
        {#if version}
          <tr><td class="k">version.plist</td><td class="mono">{Object.entries(version).map(([k, v]) => k + "=" + String(v)).join("  ")}</td></tr>
        {/if}
      </tbody>
    </table>
    <Copies entry={bundle.entry} />
  </details>
  {#if bundle.download}
    <div class="rowflex gap-above"><a class="btn" href={bundle.download} rel="noreferrer" download>Download .ipcc</a></div>
  {/if}
</fieldset>

{#if at.ref.kind === "carrier"}
  {@const rules = await getSelectedBy(sourceKey(at.ref))}
  <fieldset class="hgroup">
    <legend>Selected by ({rules.length})</legend>
    {#if rules.length}
      <p class="dimtext note">
        The SIMs Apple's manifest sends to this bundle. An MVNO rule is checked before the plain MCC-MNC entry.
        {#if rules.some((r) => r.via === "ICCID")}An ICCID rule takes every SIM card numbered from its prefix.{/if}
      </p>
      <SelectionTable {rules} />
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

{#if at.ref.kind === "country" && bundle.cc !== undefined}
  {@const carriers = await getCountryCarriers({ platform: at.ref.platform, iso: bundle.cc })}
  {#if carriers.length}
    <fieldset class="hgroup" id="carriers">
      <legend>Carriers ({carriers.length})</legend>
      {#each carriers as c (c.key)}<SourceChip source={c.key} />{/each}
    </fieldset>
  {/if}
{/if}

{#if carrier}<Rare {at} />{/if}
