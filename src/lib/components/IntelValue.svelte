<script lang="ts">
  import { bandList, type ComboComponent, type IntelValue } from "$lib/decode";
  import { comboPart } from "$lib/format";
  import Confidence from "./Confidence.svelte";

  // `bare`: the column already names the label, so only the value shows.
  let { v, raw = false, bare = false }: { v: IntelValue; raw?: boolean; bare?: boolean } = $props();

  const d = $derived(v.decoded);
  const wide = $derived(v.int !== undefined && v.int > 0xffff);
  const combo = (cs: ComboComponent[]) => cs.map((c) => comboPart(c, false)).join(" + ");
</script>

{#snippet plain()}
  {#if v.label && !bare}<span class="type">{v.label}: </span>{/if}{#if v.int !== undefined}<span class="val num">{v.text}</span>{#if wide}<span class="type hex">0x{v.int.toString(16)}</span>{/if}{:else if v.text === ""}<span class="val nul">empty</span>{:else}<span class="val str">"{v.text}"</span>{/if}
{/snippet}

<span class="iv" title={v.raw}>
  {#if !d}
    {@render plain()}
  {:else if d.kind === "bands" || d.kind === "mccBands"}
    {#if d.kind === "mccBands" && !bare}<span class="type">MCC {d.mcc}: </span>{/if}
    <span class="meaning">{#if d.bands.length}{bandList(d.bands, d.rat)}{:else}<span class="dimtext">no bands</span>{/if}</span><Confidence c={d.confidence} />
    {#if raw}<span class="type raw">{v.raw}</span>{/if}
  {:else if d.kind === "band"}
    <span class="meaning">{bandList([d.band], d.rat)}</span>{#if raw}<span class="type raw">{v.raw}</span>{/if}
  {:else if d.kind === "bits"}
    <span class="type">bits</span><span class="meaning hex">{d.bits.join(" ")}</span><Confidence c={d.confidence} />
  {:else if d.kind === "combos"}
    <span class="combos">
      {#each d.combos as c, i (i)}
        <span class="meaning combo">{combo(c.components)}{#if c.fallbackComponents}<span class="type sep">→</span>{combo(c.fallbackComponents)}{/if}</span>
      {/each}
    </span><Confidence c={d.confidence} />
    {#if raw}<span class="type raw block">{v.raw}</span>{/if}
  {/if}
</span>

<style>
  .iv { word-break: break-word; }
  .hex { margin-left: 1ch; }
  .raw { margin-left: 1ch; font-size: 10.5px; }
  .block { display: block; margin-left: 0; word-break: break-all; }
  .combos, .combo { display: block; }
</style>
