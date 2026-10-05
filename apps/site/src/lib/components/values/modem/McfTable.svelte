<script lang="ts">
  import type { ModemValue } from "@carrier-explode/schema/types";
  import type { ModemViewProps } from "../registry.ts";
  import ItemValue from "../../modem/ItemValue.svelte";
  import { mcfTable, pathText } from "./model.ts";

  /** A MediaTek array: a row per index, a column per condition it is set under. */
  let { item }: ModemViewProps = $props();

  // Past this many rows the rest sit behind a chip.
  const SHOWN = 8;

  const table = $derived(mcfTable(item.value));
  const numeric = $derived(!!table && table.rows.every((r) => r.cells.every((c) => c === undefined || c.kind === "number")));
  let all = $state(false);
  let hex = $state(false);
  const rows = $derived(table ? (all ? table.rows : table.rows.slice(0, SHOWN)) : []);

  const numberText = (v: Extract<ModemValue, { kind: "number" }>): string => (hex ? `0x${v.value.toString(16)}` : String(v.value));
</script>

{#if !table}
  <ItemValue value={item.value} label={item.label} />
{:else}
  <div class="hscroll">
    <table class="grid fit">
      {#if table.conditions.length}
        <thead><tr><th class="num">Index</th>{#each table.conditions as c (c)}<th class="mono">{c}</th>{/each}</tr></thead>
      {/if}
      <tbody>
        {#each rows as r (r.path)}
          <tr>
            <td class="num mono">{pathText(r.path)}</td>
            {#each r.cells as c, i (i)}
              <td class:num={c?.kind === "number"}>
                {#if c?.kind === "number"}<span class="mono">{numberText(c)}</span>{:else if c}<ItemValue value={c} label={null} inline />{/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if table.rows.length > SHOWN || numeric}
    <div class="rowflex">
      {#if table.rows.length > SHOWN}
        <button class="chip" onclick={() => (all = !all)}>{all ? `first ${SHOWN} rows` : `all ${table.rows.length} rows`}</button>
      {/if}
      {#if numeric}<button class="chip" onclick={() => (hex = !hex)}>{hex ? "decimal" : "hex"}</button>{/if}
    </div>
  {/if}
{/if}
