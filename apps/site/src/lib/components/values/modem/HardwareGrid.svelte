<script lang="ts">
  import type { ModemViewProps } from "../registry.ts";
  import ItemValue from "../../modem/ItemValue.svelte";
  import { hardwareGrid } from "./model.ts";

  /** A value that differs by hardware: a row per SIM scope, a column per hardware condition. */
  let { item }: ModemViewProps = $props();

  const grid = $derived(hardwareGrid(item.value));
</script>

{#if !grid}
  <ItemValue value={item.value} label={item.label} />
{:else}
  <div class="hscroll">
    <table class="grid fit">
      <thead><tr><th></th>{#each grid.conditions as c (c)}<th class="mono">{c}</th>{/each}</tr></thead>
      <tbody>
        {#each grid.rows as r (r.scope)}
          <tr>
            <td class="k">{r.scope}</td>
            {#if r.cells.kind === "each"}
              {#each grid.conditions as c (c)}
                {@const v = r.cells.values.get(c)}
                <td>{#if v}<ItemValue value={v} label={null} inline />{/if}</td>
              {/each}
            {:else}
              <td colspan={grid.conditions.length}><ItemValue value={r.cells.value} label={null} inline /></td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
