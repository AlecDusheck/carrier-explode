<script lang="ts">
  import type { ModemViewProps } from "../registry.ts";
  import ItemValue from "../../modem/ItemValue.svelte";
  import { plmnCategory } from "./model.ts";

  /** One NR CA PLMN category: its name, from its sibling item, and its PLMNs. */
  let { item, items }: ModemViewProps = $props();

  const cat = $derived(plmnCategory(item, items));
</script>

{#if !cat}
  <ItemValue value={item.value} label={item.label} />
{:else}
  <div class="rowflex">
    <b>{cat.name ?? `Category ${cat.category}`}</b>
    {#each cat.plmns as p, i (i)}
      {#if p.kind === "plmn"}<span class="chip mono">{p.mcc}-{p.mnc}</span>{:else}<span class="chip dimtext">none (placeholder)</span>{/if}
    {/each}
  </div>
{/if}
