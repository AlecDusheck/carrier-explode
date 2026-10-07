<script lang="ts">
  import { getAndroid, getAndroidSelectedBy } from "#lib/api/android.remote.ts";
  import { humanBytes, verArgs, versionHref } from "#lib/format.ts";
  import { selectionRows } from "#lib/settings.ts";
  import type { TabProps } from "#lib/types.ts";
  import CarrierMembers from "../CarrierMembers.svelte";
  import Copies from "../Copies.svelte";
  import Rare from "../Rare.svelte";
  import SelectedBy from "./SelectedBy.svelte";

  /** Laid out as the Apple Overview: the file, the SIMs that select it, and what is rare in it. */
  let { at }: TabProps = $props();

  const v = $derived(await getAndroid(verArgs(at)));
  const rules = $derived(await getAndroidSelectedBy(verArgs(at)));
</script>

<fieldset class="hgroup">
  <legend>Carrier settings</legend>
  <table class="grid fit">
    <tbody>
      <tr><td class="k">File</td><td class="mono"><a href={versionHref(at, "files", v.file.path)}>{v.file.path}</a></td></tr>
      <tr><td class="k">Size</td><td>{humanBytes(v.file.size)}</td></tr>
    </tbody>
  </table>
  <details class="more">
    <summary>Digest and source</summary>
    <table class="grid">
      <tbody><tr><td class="k">SHA-256</td><td class="mono">{v.file.sha}</td></tr></tbody>
    </table>
    <Copies entry={v.entry} />
  </details>
  {#if v.unknownFields}
    <div class="banner">{v.unknownFields} {v.unknownFields === 1 ? "field" : "fields"} this site's decoder does not know: the file is newer than its proto.</div>
  {/if}
</fieldset>

<fieldset class="hgroup">
  <legend>Selected by ({selectionRows(rules).length})</legend>
  <SelectedBy {rules} list={null} />
</fieldset>

<CarrierMembers {at} />

<Rare {at} />
