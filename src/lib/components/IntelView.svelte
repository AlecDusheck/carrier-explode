<script lang="ts">
  import type { Snippet } from "svelte";
  import { INTEL_REGIONS, filterIntel, type IntelTree } from "$lib/decode";
  import IntelNode from "./IntelNode.svelte";

  // `flat`: the key / value list as the file stores it.
  let { tree, flat }: { tree: IntelTree; flat: Snippet<[string]> } = $props();

  let filter = $state("");
  let epoch = $state(0);
  let gen = 0;
  let notes = $state(false);
  let raw = $state(false);
  let keys = $state(false);

  const f = $derived(filter.trim().toLowerCase());
  const nodes = $derived(filterIntel(tree.nodes, f));
  const bands = (b: number[] | undefined) => b?.join(" ") ?? "";
  const reg = $derived.by(() => {
    const r = tree.regulatory;
    if (!r) return undefined;
    const hit = (...xs: string[]) => !f || xs.some((x) => x.toLowerCase().includes(f));
    return {
      mcc: r.mcc.filter((x) => hit(x.mcc, x.region, "b" + x.lte.join(" b"), "n" + (x.nrSa ?? []).join(" n"), "n" + (x.nrNsa ?? []).join(" n"))),
      plmn: r.plmn.filter((x) => hit(x.plmn, x.table, "b" + x.lte.join(" b"))),
      total: r.mcc.length,
    };
  });
  const same = (a?: number[], b?: number[]) => !!a && !!b && a.join() === b.join();
</script>

<div class="rowflex" style="margin-bottom:6px">
  <input class="grow" style="min-width:120px" type="search" name="intel-filter" placeholder="filter" aria-label="filter settings" bind:value={filter} />
  <button class="btn" onclick={() => (epoch = ++gen)}>Expand</button>
  <button class="btn" onclick={() => (epoch = -++gen)}>Collapse</button>
  <button class="btn" class:on={notes} aria-pressed={notes} onclick={() => (notes = !notes)}>{notes ? "Hide notes" : "Show notes"}</button>
  <button class="btn" class:on={raw} aria-pressed={raw} onclick={() => (raw = !raw)}>Raw values</button>
  <button class="btn" class:on={keys} aria-pressed={keys} onclick={() => (keys = !keys)}>Key list</button>
</div>

{#if keys}
  {@render flat(filter)}
{:else}
  {#if reg && (reg.mcc.length || reg.plmn.length)}
    <details class="reg" open>
      <summary>Allowed bands by country code ({f ? reg.mcc.length + " of " : ""}{reg.total})</summary>
      <p class="dimtext" style="margin:2px 0 6px">From the regulatory tables below: LTE band masks, and the NR SA / NSA band lists.</p>
      <div class="hscroll">
        <table class="grid">
          <thead><tr><th>MCC</th><th>Region</th><th>LTE</th><th>NR SA</th><th>NR NSA</th></tr></thead>
          <tbody>
            {#each reg.mcc as r (r.region + r.mcc)}
              <tr>
                <td class="mono k">{r.mcc}</td>
                <td>{INTEL_REGIONS[r.region] ?? r.region}</td>
                <td class="mono">{bands(r.lte)}</td>
                <td class="mono">{bands(r.nrSa)}</td>
                <td class="mono">{#if same(r.nrSa, r.nrNsa)}<span class="dimtext">same</span>{:else}{bands(r.nrNsa)}{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if reg.plmn.length}
        <div class="hscroll" style="margin-top:6px">
          <table class="grid">
            <thead><tr><th>PLMN</th><th>Table</th><th>LTE</th></tr></thead>
            <tbody>
              {#each reg.plmn as r (r.table + r.plmn)}
                <tr><td class="mono k">{r.plmn}</td><td class="mono">{r.table}</td><td class="mono">{bands(r.lte)}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </details>
  {/if}

  <div class="tree">
    {#each nodes as n (n.path)}
      <IntelNode node={n} {notes} {raw} {epoch} filtering={!!f} />
    {:else}
      <p class="dimtext">Nothing matches.</p>
    {/each}
    {#each tree.unparsed.filter((u) => !f || (u.key + ' ' + u.value.raw).toLowerCase().includes(f)) as u (u.key)}
      <div class="row"><span class="twist" aria-hidden="true">·</span><span class="key">{u.name}</span><span class="type sep">=</span><span class="val">{u.value.raw}</span></div>
    {/each}
  </div>
{/if}

<style>
  .sep { margin: 0 0.5ch; }
  .reg { margin: 0 0 8px; }
  .reg > summary { cursor: pointer; padding: 3px 0; font-weight: bold; }
</style>
