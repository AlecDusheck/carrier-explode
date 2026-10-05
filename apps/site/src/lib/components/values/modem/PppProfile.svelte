<script lang="ts">
  import type { ModemViewProps } from "../registry.ts";
  import ItemValue from "../../modem/ItemValue.svelte";
  import { PPP_HEADS, pppProfile } from "./model.ts";

  /** A PPP profile: each control protocol's timers and tries, authentication beneath. */
  let { item }: ModemViewProps = $props();

  const ppp = $derived(pppProfile(item.value));
</script>

{#if !ppp}
  <ItemValue value={item.value} label={item.label} />
{:else}
  <div class="hscroll">
    <table class="grid fit">
      <thead><tr><th></th>{#each PPP_HEADS as h (h)}<th class="num">{h}</th>{/each}</tr></thead>
      <tbody>
        {#each ppp.rows as r (r.protocol)}
          <tr>
            <td class="k">{r.protocol}</td>
            {#each r.cells as c, i (i)}<td class="num mono">{c ?? ""}</td>{/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if ppp.authRetry !== undefined || ppp.authTimeout !== undefined}
    <div class="dimtext">Auth: {ppp.authRetry ?? "?"} retries, timeout {ppp.authTimeout ?? "?"}</div>
  {/if}
{/if}
