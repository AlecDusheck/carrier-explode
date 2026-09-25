<script lang="ts">
  import type { PolicyNode } from "$lib/decode/policy";
  import PolicyItem from "./PolicyItem.svelte";

  let { node, depth = 0, comments }: { node: PolicyNode; depth?: number; comments: boolean } = $props();

  const WORD: Record<string, string> = {
    if: "IF", then: "THEN", else: "ELSE", select: "SELECT", case: "CASE", actions: "ACTIONS",
    initial: "DEFINE", any_of: "ANY OF", all_of: "ALL OF", not: "NOT",
  };

  const kids = $derived(node.children.filter((c) => comments || c.kind !== "comment"));
  // NOT over a single leaf reads as one line.
  const inline = $derived(node.tag === "not" && kids.length === 1 && !kids[0].children.length ? kids[0] : null);
  const attrs = (n: PolicyNode) => Object.entries(n.attrs);
  // Deep nodes start folded; a click flips whichever way it started.
  let flipped = $state(false);
  const open = $derived(depth < 8 !== flipped);
</script>

{#snippet leaf(n: PolicyNode)}
  <span class="t {n.kind}">{n.tag}</span>
  {#each attrs(n) as [k, v] (k)}<span class="a">{k}=<span class="v">{v}</span></span>{/each}
  {#if n.text}<span class="x">{n.text}</span>{/if}
{/snippet}

{#if node.kind === "comment"}
  <div class="row c">{node.text}</div>
{:else if inline}
  <div class="row"><span class="w logic">NOT</span> {@render leaf(inline)}</div>
{:else if !kids.length && !WORD[node.tag]}
  <div class="row">{@render leaf(node)}</div>
{:else}
  <button class="row head" aria-expanded={open} onclick={() => (flipped = !flipped)}>
    <span class="twist">{open ? "▾" : "▸"}</span>
    {#if WORD[node.tag]}
      <span class="w {node.kind}">{WORD[node.tag]}</span>
      {#each attrs(node) as [k, v] (k)}<span class="a">{k}=<span class="v">{v}</span></span>{/each}
      {#if node.text}<span class="x">{node.text}</span>{/if}
    {:else}
      {@render leaf(node)}
    {/if}
    {#if !open}<span class="dimtext more">… {kids.length}</span>{/if}
  </button>
  {#if open}
    <div class="children">
      {#each kids as k, i (i)}<PolicyItem node={k} depth={depth + 1} {comments} />{/each}
    </div>
  {/if}
{/if}

<style>
  .row { display: block; padding: 1px 0; word-break: break-word; }
  button.head {
    font: inherit; background: none; border: 0; padding: 1px 0; color: inherit;
    text-align: left; cursor: pointer; width: 100%;
  }
  button.head:hover { background: #eef2f7; }
  .twist { display: inline-block; width: 14px; color: var(--text-dim); }
  .w { font-weight: bold; }
  .w.branch { color: #6a2f8a; }
  .w.logic { color: #8a4a14; }
  .t { font-weight: bold; }
  .t.condition { color: #1f3f8a; }
  .t.action { color: #14632a; }
  .t.define { color: #6a2f8a; }
  .t.policy { color: #1b3d6b; }
  .a, .x, .more { margin-left: 0.7ch; }
  .a { color: var(--text-dim); }
  .v { color: #7a2f2f; }
  .x { color: #14442a; }
  .c { color: var(--text-dim); font-style: italic; white-space: pre-wrap; font-family: var(--ui); font-size: 10.5px; }
  .children { padding-left: 12px; border-left: 1px dotted #b9b5ac; margin-left: 6px; }
  @media (max-width: 760px) {
    button.head { min-height: 28px; }
  }
</style>
