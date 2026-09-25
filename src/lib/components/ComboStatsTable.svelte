<script lang="ts">
  import type { Snippet } from "svelte";
  import { bandList, type ComboSetRow } from "$lib/decode";
  import Variants from "./Variants.svelte";

  let { rows, action }: {
    /** One carrier's numbers, a row per group of platforms that share them. */
    rows: ComboSetRow[];
    /** Last column: a control for the row. */
    action?: Snippet<[ComboSetRow]>;
  } = $props();
</script>

<div class="hscroll">
  <table class="grid">
    <thead>
      <tr>
        <th>Platforms</th><th class="num">Combos</th><th class="num">EN-DC</th><th class="num">NR</th><th class="num">LTE</th>
        <th class="num">NR-DC</th><th class="num">Max CC</th><th>NR bands</th><th>LTE anchors</th>{#if action}<th></th>{/if}
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.sha1)}
        <tr>
          <td class="plat"><Variants variants={r.variants} /></td>
          <td class="num">{r.combos}</td>
          <td class="num">{r.endc}</td>
          <td class="num">{r.nr}</td>
          <td class="num">{r.lte}</td>
          <td class="num">{r.nrdc}</td>
          <td class="num">{r.maxComponents}</td>
          <td class="mono bands">{bandList(r.fr1Bands, "nr")}{#if r.fr2Bands.length}<br /><span class="dimtext">FR2</span> {bandList(r.fr2Bands, "nr")}{/if}</td>
          <td class="mono bands">{bandList(r.lteAnchors, "lte")}</td>
          {#if action}<td>{@render action(r)}</td>{/if}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  td.bands { min-width: 14em; }
  td.plat { white-space: nowrap; }
</style>
