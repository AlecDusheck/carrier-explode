<script lang="ts">
  import { getAndroid } from "#lib/api/android.remote.ts";
  import { entryLabel, placeHref } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import Rare from "../Rare.svelte";

  let { at }: TabProps = $props();

  const v = $derived(await getAndroid({ source: at.source, slug: at.version }));
</script>

<fieldset class="hgroup">
  <legend>CarrierSettings</legend>
  <table class="grid fit">
    <tbody>
      <tr><td class="k">Canonical name</td><td class="mono">{v.canonicalName}</td></tr>
      <tr><td class="k">Version</td><td class="mono">{v.version ?? "not set"}</td></tr>
      <tr><td class="k">From</td><td>{entryLabel(v.entry, "android")}</td></tr>
      <tr><td class="k">Holds</td><td>{v.counts.configs} config keys, {v.counts.apns} APNs, {v.counts.vendor} vendor configs</td></tr>
      {#if v.entry.sha}<tr><td class="k">SHA-256</td><td class="mono wrap">{v.entry.sha}</td></tr>{/if}
    </tbody>
  </table>
  {#if v.unknownFields}
    <p class="banner">{v.unknownFields} fields this site's decoder does not know yet: the file is newer than its proto.</p>
  {/if}
  {#if v.place}<p class="dimtext note">Part of <a href={placeHref(v.place)}>this carrier's page</a>, beside its iOS bundles.</p>{/if}
</fieldset>

<Rare {at} file="CarrierConfig" />
