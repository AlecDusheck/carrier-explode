<script lang="ts">
  import { bandList, type BasebandSummary } from "$lib/decode";
  import Variants from "../Variants.svelte";
  import type { Baseband } from "./types";

  let { tables, mccs }: { tables: BasebandSummary["amprNs"]; mccs: Baseband["mccs"] } = $props();

  /** More MCCs than this fold behind a summary. */
  const FOLD = 8;

  let picked = $state(0);
  let query = $state("");

  const table = $derived(tables[Math.min(picked, tables.length - 1)]);
  const groups = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return table.groups;
    return table.groups.filter((g) => g.mccs.some((m) => m.includes(q) || (mccs[m]?.name ?? "").toLowerCase().includes(q)));
  });
</script>

<fieldset class="hgroup" id="power">
  <legend>Power: A-MPR network signalling</legend>
  <p class="dimtext note">pt.mbn NV 64628: the NS value signalled per LTE band, without and with carrier aggregation, by MCC.</p>
  <div class="filters">
    {#if tables.length > 1}
      <label class="lbl">
        Table
        <select name="ampr" bind:value={picked}>
          {#each tables as x, i (x.sha1)}
            <option value={i}>{i + 1}: {x.variants.length} variants, platforms {[...new Set(x.variants.map((v) => v.platform))].join(", ")}</option>
          {/each}
        </select>
      </label>
    {/if}
    <input type="search" name="ampr-filter" placeholder="MCC or country" aria-label="filter by MCC or country" bind:value={query} />
  </div>
  <div class="hscroll">
    <table class="grid">
      <thead><tr><th>Countries</th><th class="num">Band</th><th class="num">NS</th><th class="num">NS with CA</th></tr></thead>
      <tbody>
        {#each groups as g, gi (gi)}
          {#each g.bands as b, bi (bi)}
            <tr>
              {#if bi === 0}
                <td rowspan={g.bands.length} class="countries">
                  {#if g.mccs.length > FOLD}
                    <details>
                      <summary>{g.mccs.length} MCCs: {[...new Set(g.mccs.map((m) => mccs[m]?.name ?? m))].slice(0, 4).join(", ")}, …</summary>
                      {#each g.mccs as m (m)}<span class="chip" title={mccs[m]?.name}>{m} {mccs[m]?.cc.toUpperCase() ?? ""}</span>{/each}
                    </details>
                  {:else}
                    {#each g.mccs as m (m)}<span class="chip" title={mccs[m]?.name}>{m} {mccs[m]?.name ?? ""}</span>{/each}
                  {/if}
                </td>
              {/if}
              <td class="num mono">{bandList([b.band], "lte")}</td>
              <td class="num">{b.nsNoCa ?? ""}</td>
              <td class="num">{b.nsWithCa ?? ""}</td>
            </tr>
          {/each}
        {:else}
          <tr><td colspan="4" class="dimtext">No group matches.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="rowflex serves"><span class="dimtext">Serves</span> <Variants variants={table.variants} /></div>
</fieldset>

<style>
  .serves { margin-top: 4px; }
  td.countries { max-width: 360px; }
  @media (max-width: 760px) {
    td.countries { min-width: 12em; }
  }
</style>
