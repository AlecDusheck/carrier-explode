<script lang="ts">
  import { type BasebandSummary } from "@carrier-explode/decode-ios";
  import { bandList } from "@carrier-explode/decode-qualcomm";
  import Variants from "../Variants.svelte";
  import type { Baseband } from "./types";

  let { tables, mccs }: { tables: BasebandSummary["amprNs"]; mccs: Baseband["mccs"] } = $props();

  /** More countries than this fold behind a summary. */
  const FOLD = 8;

  /** A group's MCCs by country, so each country is one entry however many codes it has. */
  const byCountry = (codes: readonly string[]): Array<[string, string[]]> => [...Map.groupBy(codes, (m) => mccs[m]?.name ?? m)];

  let picked = $state(0);
  let query = $state("");

  const table = $derived(tables[Math.min(picked, tables.length - 1)]);
  const groups = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const all = table?.groups ?? [];
    if (!q) return all;
    return all.filter((g) => g.mccs.some((m) => m.includes(q) || (mccs[m]?.name ?? "").toLowerCase().includes(q)));
  });
</script>

{#snippet chips(countries: Array<[string, string[]]>)}
  {#each countries as [name, codes] (name)}<span class="chip">{name}{#if codes[0] !== name}<span class="mono dimtext sp">{codes.join(" ")}</span>{/if}</span>{/each}
{/snippet}

<fieldset class="hgroup" id="power">
  <legend>Power: A-MPR network signalling</legend>
  <p class="dimtext note">pt.mbn NV 64628: the NS value signalled per LTE band, without and with carrier aggregation, by MCC.</p>
  <div class="filters">
    {#if tables.length > 1}
      <label class="lbl">
        Table
        <select name="ampr" bind:value={picked}>
          {#each tables as x, i (i)}
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
        {#each groups as g (g)}
          {#each g.bands as b, bi (bi)}
            <tr>
              {#if bi === 0}
                {@const countries = byCountry(g.mccs)}
                <td rowspan={g.bands.length} class="countries">
                  {#if countries.length > FOLD}
                    <details>
                      <summary>{countries.length} countries: {countries.slice(0, 4).map(([name]) => name).join(", ")}, …</summary>
                      {@render chips(countries)}
                    </details>
                  {:else}
                    {@render chips(countries)}
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
  <div class="rowflex serves"><span class="dimtext">Serves</span> <Variants variants={table?.variants} /></div>
</fieldset>

<style>
  .serves { margin-top: 4px; }
  td.countries { max-width: 360px; }
  @media (max-width: 760px) {
    td.countries { min-width: 12em; }
  }
</style>
