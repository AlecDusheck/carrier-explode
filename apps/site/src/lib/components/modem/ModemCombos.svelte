<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import type { ComboSet } from "@carrier-explode/schema/types";
  import { getModemCombos } from "#lib/api/android.remote.ts";
  import { combinationRows } from "#lib/combos.ts";
  import { toggleIn } from "#lib/ui-state.svelte.ts";
  import Pane from "../Pane.svelte";
  import ComboTable from "../ComboTable.svelte";

  /** A config's band-combination lists, each loaded when opened: one can hold thousands. */
  let { sets }: { sets: readonly ComboSet[] } = $props();

  const open = new SvelteSet<string>();
  const total = $derived(sets.reduce((n, s) => n + s.count, 0));
</script>

<fieldset class="hgroup">
  <legend>Band combinations ({total})</legend>
  <div class="hscroll">
    <table class="grid">
      <thead><tr><th>Source</th><th class="num">Combos</th><th></th></tr></thead>
      <tbody>
        {#each sets as s (s.key)}
          {@const on = open.has(s.key)}
          <tr>
            <td class="mono src">
              {s.sources[0]}{#if s.sources.length > 1}<span class="dimtext" title={s.sources.join("\n")}> +{s.sources.length - 1} alike</span>{/if}
            </td>
            <td class="num">{s.count}</td>
            <td><button class="btn" class:on aria-expanded={on} onclick={() => toggleIn(open, s.key)}>Combos</button></td>
          </tr>
          {#if on}
            <tr>
              <td colspan="3">
                <Pane awaiting={{ kind: "decode", name: s.sources[0] ?? "combos" }}><ComboTable rows={combinationRows(await getModemCombos(s.key))} /></Pane>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
</fieldset>

<style>
  .src { word-break: break-all; }
</style>
