<script lang="ts">
  import type { ModemViewProps } from "../registry.ts";
  import ItemValue from "../../modem/ItemValue.svelte";
  import { sidNids } from "./model.ts";

  /** CDMA SID/NID pairs, the empty slots left out. */
  let { item }: ModemViewProps = $props();

  const pairs = $derived(sidNids(item.value));
</script>

{#if !pairs}
  <ItemValue value={item.value} label={item.label} />
{:else if !pairs.length}
  <span class="dimtext">none set</span>
{:else}
  <table class="grid fit">
    <thead><tr><th class="num">SID</th><th class="num">NID</th></tr></thead>
    <tbody>
      {#each pairs as p, i (i)}
        <tr><td class="num mono">{p.sid}</td><td class="num mono">{p.nid}</td></tr>
      {/each}
    </tbody>
  </table>
{/if}
