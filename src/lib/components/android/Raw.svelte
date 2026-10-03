<script lang="ts">
  import { getAndroidRaw } from "#lib/api/android.remote.ts";
  import { humanBytes } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import Tree from "../Tree.svelte";

  let { at }: TabProps = $props();

  const raw = $derived(await getAndroidRaw({ source: at.source, slug: at.version }));
</script>

<fieldset class="hgroup">
  <legend>configs ({Object.keys(raw.configs).length})</legend>
  <Tree value={raw.configs} ctx={{ platform: "android", source: at.source, file: "config" }} />
</fieldset>

<fieldset class="hgroup">
  <legend>vendor_configs ({raw.vendor.length})</legend>
  {#if raw.vendor.length}
    <p class="dimtext note">Opaque to Android itself: each is read only by the vendor client it names.</p>
    <table class="grid fit">
      <thead><tr><th>Client</th><th class="num">Size</th></tr></thead>
      <tbody>
        {#each raw.vendor as c (c.name)}<tr><td class="mono">{c.name}</td><td class="num">{humanBytes(c.size)}</td></tr>{/each}
      </tbody>
    </table>
  {:else}
    <p class="dimtext note">None.</p>
  {/if}
</fieldset>
