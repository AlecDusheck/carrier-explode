<script lang="ts">
  import { getAndroid } from "#lib/api/android.remote.ts";
  import { getBundleHead } from "#lib/api/bundles.remote.ts";
  import { verArgs } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import Copies from "../Copies.svelte";
  import LinePicker from "../LinePicker.svelte";
  import PlatformPair from "../PlatformPair.svelte";
  import Rare from "../Rare.svelte";

  let { at }: TabProps = $props();

  const [v, head] = $derived(await Promise.all([getAndroid(verArgs(at)), getBundleHead(verArgs(at))]));
</script>

<LinePicker {head} tab="" />

<fieldset class="hgroup">
  <legend>CarrierSettings</legend>
  <table class="grid fit">
    <tbody>
      <tr><td class="k">Canonical name</td><td class="mono">{v.canonicalName}</td></tr>
      <tr><td class="k">Version</td><td class="mono">{v.version ?? "not set"}</td></tr>
      <tr><td class="k">Holds</td><td>{v.counts.configs} config keys, {v.counts.apns} APNs, {v.counts.vendor} vendor configs</td></tr>
    </tbody>
  </table>
  {#if v.unknownFields}
    <div class="banner">{v.unknownFields} fields this site's decoder does not know: the file is newer than its proto.</div>
  {/if}
</fieldset>

<Copies entry={v.entry} />
<PlatformPair {at} />
<Rare {at} file="CarrierConfig" />
