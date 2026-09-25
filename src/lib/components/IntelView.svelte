<script lang="ts">
  import type { Snippet } from "svelte";
  import { bandList, filterIntel, type IntelTree } from "$lib/decode";
  import { Folding } from "$lib/ui-state.svelte";
  import IntelNode from "./IntelNode.svelte";
  import TreeToolbar from "./TreeToolbar.svelte";

  // `flat`: the key / value list as the file stores it.
  let { tree, flat }: { tree: IntelTree; flat: Snippet<[string]> } = $props();

  let filter = $state("");
  let notes = $state(false);
  let raw = $state(false);
  let keys = $state(false);
  const fold = new Folding();

  const f = $derived(filter.trim().toLowerCase());
  const nodes = $derived(filterIntel(tree.nodes, f));
  const lte = (b: number[] | undefined) => bandList(b ?? [], "lte");
  const nr = (b: number[] | undefined) => bandList(b ?? [], "nr");
  const reg = $derived.by(() => {
    const r = tree.regulatory;
    if (!r) return undefined;
    const hit = (...xs: string[]) => !f || xs.some((x) => x.toLowerCase().includes(f));
    return {
      mcc: r.mcc.filter((x) => hit(x.mcc, x.region, x.regionName, lte(x.lte), nr(x.nrSa), nr(x.nrNsa))),
      plmn: r.plmn.filter((x) => hit(x.plmn, x.table, lte(x.lte))),
      total: r.mcc.length,
    };
  });
  const same = (a?: number[], b?: number[]) => !!a && !!b && a.join() === b.join();
  const unparsed = $derived(tree.unparsed.filter((u) => !f || (u.key + " " + u.value.raw).toLowerCase().includes(f)));
</script>

<TreeToolbar bind:filter bind:notes {fold} name="intel-filter" label="filter settings">
  <button class="btn" class:on={raw} aria-pressed={raw} onclick={() => (raw = !raw)}>Raw values</button>
  <button class="btn" class:on={keys} aria-pressed={keys} onclick={() => (keys = !keys)}>Key list</button>
</TreeToolbar>

{#if keys}
  {@render flat(filter)}
{:else}
  {#if reg && (reg.mcc.length || reg.plmn.length)}
    <details class="reg" open>
      <summary>Allowed bands by country code ({f ? reg.mcc.length + " of " : ""}{reg.total})</summary>
      <p class="dimtext note">From the regulatory tables below: LTE band masks, and the NR SA / NSA band lists.</p>
      <div class="hscroll">
        <table class="grid">
          <thead><tr><th>MCC</th><th>Region</th><th>LTE</th><th>NR SA</th><th>NR NSA</th></tr></thead>
          <tbody>
            {#each reg.mcc as r (r.region + r.mcc)}
              <tr>
                <td class="mono k">{r.mcc}</td>
                <td>{r.regionName}</td>
                <td class="mono">{lte(r.lte)}</td>
                <td class="mono">{nr(r.nrSa)}</td>
                <td class="mono">{#if same(r.nrSa, r.nrNsa)}<span class="dimtext">same</span>{:else}{nr(r.nrNsa)}{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if reg.plmn.length}
        <div class="hscroll gap-above">
          <table class="grid">
            <thead><tr><th>PLMN</th><th>Table</th><th>LTE</th></tr></thead>
            <tbody>
              {#each reg.plmn as r (r.table + r.plmn)}
                <tr><td class="mono k">{r.plmn}</td><td class="mono">{r.table}</td><td class="mono">{lte(r.lte)}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </details>
  {/if}

  <div class="tree">
    {#each nodes as n (n.path)}
      <IntelNode node={n} {notes} {raw} {fold} filtering={!!f} />
    {:else}
      <p class="dimtext">Nothing matches.</p>
    {/each}
    {#each unparsed as u (u.key)}
      <div class="row"><span class="twist" aria-hidden="true">·</span><span class="key">{u.name}</span><span class="type sep">=</span><span class="val">{u.value.raw}</span></div>
    {/each}
  </div>
{/if}

<style>
  .reg { margin: 0 0 8px; }
  .reg > summary { cursor: pointer; padding: 3px 0; font-weight: bold; }
  .reg .note { margin: 2px 0 6px; }
</style>
