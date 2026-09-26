<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { getBasebandCombos } from "$lib/api/tables.remote";
  import { mergeComboSets, type BandComboSet, type CarrierMapping } from "$lib/decode";
  import { bundleHref } from "$lib/format";
  import { toggleIn } from "$lib/ui-state.svelte";
  import Pane from "../Pane.svelte";
  import ComboTable from "../ComboTable.svelte";
  import ComboStatsTable from "../ComboStatsTable.svelte";

  let { id, bandCombos, carrierMap }: {
    /** The package, for fetching one carrier's combo list. */
    id: string;
    bandCombos: BandComboSet[];
    carrierMap: Record<string, CarrierMapping> | null;
  } = $props();

  const carriers = $derived.by(() => {
    const listed = bandCombos.flatMap((s) => s.carriers);
    return [...new Set(listed.map((c) => c.tag))].map((tag) => {
      const map = carrierMap?.[tag];
      const plmns = map?.plmns ?? listed.find((c) => c.tag === tag)?.plmns ?? [];
      return { tag, map, plmns, rows: mergeComboSets(bandCombos, tag) };
    });
  });
  /** Open combo lists, by tag + sha1. */
  const open = new SvelteSet<string>();
</script>

<fieldset class="hgroup" id="carriers">
  <legend>Carriers with band combos ({carriers.length})</legend>
  <p class="dimtext note">From band_combos_per_plmn.xml, with the bundles the OTA manifest routes each PLMN to.</p>
  <div class="rowflex taglinks">{#each carriers as c (c.tag)}<a class="chip" href="#{c.tag}">{c.tag}</a>{/each}</div>
  {#each carriers as { tag, map, plmns, rows } (tag)}
    <section class="carrier" id={tag}>
      <h3>{tag}</h3>
      <div class="rowflex">
        <span class="dimtext">PLMN</span>
        {#each plmns as p (p)}<span class="chip mono">{p}</span>{/each}
      </div>
      {#if map}
        <div class="rowflex">
          <span class="dimtext">Bundles</span>
          {#each map.bundles as n (n)}<a class="chip" href={bundleHref("carriers", n)}>{n}</a>{:else}<span class="dimtext">none mapped</span>{/each}
        </div>
        {#if map.mvnoBundles.length}
          <details>
            <summary class="dimtext">{map.mvnoBundles.length} MVNO bundles on these PLMNs</summary>
            {#each map.mvnoBundles as n (n)}<a class="chip" href={bundleHref("carriers", n)}>{n}</a>{/each}
          </details>
        {/if}
      {/if}
      <ComboStatsTable {rows}>
        {#snippet action(r)}
          {@const on = open.has(tag + r.sha1)}
          <button class="btn" class:on aria-expanded={on} onclick={() => toggleIn(open, tag + r.sha1)}>Combos</button>
        {/snippet}
      </ComboStatsTable>
      {#each rows as r (r.sha1)}
        {#if open.has(tag + r.sha1)}
          <Pane>
            <ComboTable combos={await getBasebandCombos({ id, sha1: r.sha1, tag })} />
          </Pane>
        {/if}
      {/each}
    </section>
  {:else}
    <p class="dimtext">No band_combos_per_plmn.xml in this package.</p>
  {/each}
</fieldset>

<style>
  .carrier { border-top: 1px solid var(--shadow); padding: 6px 0; scroll-margin-top: 8px; }
  .carrier h3 { margin: 0 0 4px; font-size: 13px; }
  .carrier .rowflex { margin-bottom: 4px; }
  .carrier details { margin-bottom: 4px; }
  @media (max-width: 760px) {
    .taglinks .chip { padding: 5px 8px; }
  }
</style>
