<script lang="ts">
  import type { ModemViewProps } from "../registry.ts";
  import ItemValue from "../../modem/ItemValue.svelte";
  import { countedList } from "./model.ts";

  /** A list cut to the length its count field gives; the unused slots are not shown. */
  let { item }: ModemViewProps = $props();

  const c = $derived(countedList(item));
</script>

{#if !c}
  <ItemValue value={item.value} label={item.label} />
{:else}
  <div>
    <span class="dimtext">{c.list}</span> =
    {#if c.values.length}<span class="mono">{c.values.join(", ")}</span>{:else}<span class="dimtext">none</span>{/if}
    {#if c.overrun !== undefined}<span class="chip warn" title="the list holds fewer entries than its count">count {c.overrun}</span>{/if}
  </div>
  {#each c.rest as [k, v] (k)}<div><span class="dimtext">{k}</span> = <ItemValue value={v} label={null} inline /></div>{/each}
{/if}
