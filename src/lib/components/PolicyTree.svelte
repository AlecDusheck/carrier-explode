<script lang="ts">
  import { parsePolicyXml, walkPolicy, type PolicyNode } from "$lib/decode";
  import PolicyItem, { type NoteFirsts } from "./PolicyItem.svelte";

  let { xml }: { xml: string } = $props();

  let comments = $state(false);
  let notes = $state(false);
  const nodes = $derived(parsePolicyXml(xml));
  // "Show notes" explains each element and attribute once, where it first appears.
  const firsts = $derived.by((): NoteFirsts => {
    const el: Record<string, PolicyNode> = {}, attr: Record<string, PolicyNode> = {};
    for (const n of walkPolicy(nodes)) {
      if (!Object.hasOwn(el, n.tag)) el[n.tag] = n;
      for (const k of Object.keys(n.attrs)) if (!Object.hasOwn(attr, n.tag + "@" + k)) attr[n.tag + "@" + k] = n;
    }
    return { el, attr };
  });
</script>

<div class="filters">
  <label class="lbl"><input type="checkbox" bind:checked={comments} /> Comments</label>
  <button class="btn" class:on={notes} aria-pressed={notes} onclick={() => (notes = !notes)}>{notes ? "Hide notes" : "Show notes"}</button>
  <span class="dimtext legend">
    <span class="k cond">condition</span> <span class="k act">action</span> <span class="k def">definition</span>
    · <span class="underline-doc">underlined</span> names explain themselves
  </span>
</div>
<div class="tree box">
  {#each nodes as n, i (i)}
    {#if comments || n.kind !== "comment"}<PolicyItem node={n} {comments} {notes} {firsts} />{/if}
  {/each}
</div>

<style>
  .box {
    background: var(--field); padding: 6px; overflow-x: auto;
    border: 2px solid; border-color: var(--shadow) var(--light) var(--light) var(--shadow);
  }
  .k { font-family: var(--mono); font-weight: bold; }
  .cond { color: var(--policy-condition); }
  .act { color: var(--policy-action); }
  .def { color: var(--policy-define); }
</style>
