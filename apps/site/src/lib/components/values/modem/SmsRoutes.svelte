<script lang="ts">
  import type { ModemViewProps } from "../registry.ts";
  import ItemValue from "../../modem/ItemValue.svelte";
  import { SMS_ROUTE_HEADS, smsRoutes } from "./model.ts";

  /** SMS routing: six rows of routes and memory stores, and the transfer-status flag. */
  let { item }: ModemViewProps = $props();

  const routes = $derived(smsRoutes(item.value));
</script>

{#if !routes}
  <ItemValue value={item.value} label={item.label} />
{:else}
  <div class="hscroll">
    <table class="grid fit">
      <thead><tr><th class="num">#</th>{#each SMS_ROUTE_HEADS as h (h)}<th class="num">{h}</th>{/each}</tr></thead>
      <tbody>
        {#each routes.rows as r, i (i)}
          <tr><td class="num">{i + 1}</td>{#each r as n, j (j)}<td class="num mono">{n}</td>{/each}</tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div><span class="dimtext">TransferStatusReport</span> = <span class="mono">{routes.transferStatusReport}</span></div>
{/if}
