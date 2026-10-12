<script lang="ts">
  import { parsePolicyXml, walkPolicy } from "@carrier-explode/decode-qualcomm";
  import { treeKeys } from "#lib/keys.ts";
  import PolicyItem from "./PolicyItem.svelte";

  let { xml }: { xml: string } = $props();

  let comments = $state(false);
  const nodes = $derived(parsePolicyXml(xml));
  const hasComments = $derived(walkPolicy(nodes).some((n) => n.kind === "comment"));
</script>

<div class="filters">
  {#if hasComments}<label class="lbl"><input type="checkbox" name="comments" bind:checked={comments} /> Comments</label>{/if}
  <span class="dimtext legend">
    <span class="mono policy-term condition">condition</span> <span class="mono policy-term action">action</span> <span class="mono policy-term define">definition</span>
    · <span class="underline-doc">underlined</span> names explain themselves
  </span>
</div>
<div class="tree box sunken" {@attach treeKeys}>
  {#each nodes as n (n)}
    {#if comments || n.kind !== "comment"}<PolicyItem node={n} {comments} />{/if}
  {/each}
</div>

<style>
  .box {
    /* In a table cell it would shrink to what the other columns leave; a phone gets most of the screen. */
    min-width: min(36rem, 80vw);
    padding: 6px; overflow-x: auto;
  }
</style>
