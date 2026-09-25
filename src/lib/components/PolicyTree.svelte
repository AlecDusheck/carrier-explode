<script lang="ts">
  import { parsePolicyXml } from "$lib/decode/policy";
  import PolicyItem from "./PolicyItem.svelte";

  let { xml }: { xml: string } = $props();

  let comments = $state(false);
  const nodes = $derived(parsePolicyXml(xml));
</script>

<div class="rowflex" style="margin-bottom:4px">
  <label class="lbl"><input type="checkbox" bind:checked={comments} /> Comments</label>
  <span class="dimtext legend">
    <span class="k cond">condition</span> <span class="k act">action</span> <span class="k def">definition</span>
  </span>
</div>
<div class="tree box">
  {#each nodes as n, i (i)}
    {#if comments || n.kind !== "comment"}<PolicyItem node={n} {comments} />{/if}
  {/each}
</div>

<style>
  .box {
    background: var(--field); padding: 6px; overflow-x: auto;
    border: 2px solid; border-color: var(--shadow) var(--light) var(--light) var(--shadow);
  }
  .k { font-family: var(--mono); font-weight: bold; }
  .cond { color: #1f3f8a; }
  .act { color: #14632a; }
  .def { color: #6a2f8a; }
</style>
