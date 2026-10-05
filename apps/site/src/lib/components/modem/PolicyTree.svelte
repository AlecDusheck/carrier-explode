<script lang="ts">
  import { parsePolicyXml, walkPolicy } from "@carrier-explode/decode-qualcomm";
  import PolicyItem from "./PolicyItem.svelte";

  let { xml }: { xml: string } = $props();

  let comments = $state(false);
  const nodes = $derived(parsePolicyXml(xml));
  const hasComments = $derived(walkPolicy(nodes).some((n) => n.kind === "comment"));
</script>

<div class="filters">
  {#if hasComments}<label class="lbl"><input type="checkbox" bind:checked={comments} /> Comments</label>{/if}
  <span class="dimtext legend">
    <span class="k cond">condition</span> <span class="k act">action</span> <span class="k def">definition</span>
    · <span class="underline-doc">underlined</span> names explain themselves
  </span>
</div>
<div class="tree box">
  {#each nodes as n, i (i)}
    {#if comments || n.kind !== "comment"}<PolicyItem node={n} {comments} />{/if}
  {/each}
</div>

<style>
  .box {
    /* In a table cell it would shrink to what the other columns leave; a phone gets most of the screen. */
    min-width: min(36rem, 80vw);
    background: var(--field); padding: 6px; overflow-x: auto;
    border: 2px solid; border-color: var(--shadow) var(--light) var(--light) var(--shadow);
  }
  .k { font-family: var(--mono); font-weight: bold; }
  .cond { color: var(--policy-condition); }
  .act { color: var(--policy-action); }
  .def { color: var(--policy-define); }
</style>
