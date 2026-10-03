<script lang="ts">
  import { getAndroidFiles } from "#lib/api/android.remote.ts";
  import { getBundleHead } from "#lib/api/bundles.remote.ts";
  import { humanBytes, verArgs } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import LinePicker from "../LinePicker.svelte";
  import Tree from "../Tree.svelte";

  /** The CarrierSettings file as it is: its configs, APNs and vendor configs, each in the value tree. */
  let { at }: TabProps = $props();

  const [files, head] = $derived(await Promise.all([getAndroidFiles(verArgs(at)), getBundleHead(verArgs(at))]));
</script>

<LinePicker {head} tab="files" />

<fieldset class="hgroup">
  <legend>configs ({Object.keys(files.configs).length})</legend>
  <Tree value={files.configs} ctx={{ platform: at.ref.platform, source: at.source, file: "config" }} />
</fieldset>

<fieldset class="hgroup">
  <legend>apns ({files.apns.length})</legend>
  <Tree value={files.apns} ctx={{ platform: at.ref.platform, source: at.source, file: "" }} />
</fieldset>

<fieldset class="hgroup">
  <legend>vendor_configs ({files.vendor.length})</legend>
  {#if files.vendor.length}
    <p class="dimtext note">Opaque to Android: each is read only by the vendor client it names.</p>
    <table class="grid fit">
      <thead><tr><th>Client</th><th class="num">Size</th></tr></thead>
      <tbody>
        {#each files.vendor as c (c.name)}<tr><td class="mono">{c.name}</td><td class="num">{humanBytes(c.size)}</td></tr>{/each}
      </tbody>
    </table>
  {:else}
    <p class="dimtext note">None.</p>
  {/if}
</fieldset>
