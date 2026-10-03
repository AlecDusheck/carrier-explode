<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { describePolicyAttr, describePolicyElement, type PolicyNode } from "#lib/decode/index.ts";
  import { toggleIn } from "#lib/ui-state.svelte.ts";
  import Confidence from "./Confidence.svelte";
  import PolicyItem from "./PolicyItem.svelte";

  let { node, depth = 0, comments }: { node: PolicyNode; depth?: number; comments: boolean } = $props();

  const WORD: Record<string, string> = {
    if: "IF", then: "THEN", else: "ELSE", select: "SELECT", case: "CASE", actions: "ACTIONS",
    initial: "DEFINE", any_of: "ANY OF", all_of: "ALL OF", not: "NOT",
  };
  // These already read as prose; a note would only repeat the word.
  const PLAIN = new Set(["if", "then", "else", "actions", "case", "rule", "cond", "conditions", "all_of", "any_of", "not", "true"]);

  // Deep nodes start folded; a click flips whichever way it started.
  let flipped = $state(false);
  const open = $derived(depth < 8 !== flipped);
  let showNote = $state(false);
  const attrOpen = new SvelteSet<string>();

  const kids = $derived(node.children.filter((c) => comments || c.kind !== "comment"));
  // NOT over a single leaf reads as one line.
  const inline = $derived(node.tag === "not" && kids.length === 1 && !kids[0].children.length ? kids[0] : null);
  // The element whose name this row shows.
  const shown = $derived(inline ?? node);
  const doc = $derived(PLAIN.has(shown.tag) ? undefined : describePolicyElement(shown.tag));
  const attrs = $derived(Object.entries(shown.attrs).map(([k, v]) => ({ k, v, note: describePolicyAttr(shown.tag, k) })));
</script>

{#snippet name(label: string, cls: string)}
  {#if doc}
    <button type="button" class="{cls} doc" class:on={showNote} aria-expanded={showNote}
      onclick={() => (showNote = !showNote)}>{label}</button>
  {:else}
    <span class={cls}>{label}</span>
  {/if}
{/snippet}

{#snippet rest(n: PolicyNode)}
  {#each attrs as a (a.k)}
    <span class="a">{#if a.note}<button type="button" class="an doc" class:on={attrOpen.has(a.k)} aria-expanded={attrOpen.has(a.k)}
        onclick={() => toggleIn(attrOpen, a.k)}>{a.k}</button>{:else}{a.k}{/if}=<span class="v">{a.v}</span></span>
  {/each}
  {#if n.text}<span class="x">{n.text}</span>{/if}
{/snippet}

{#snippet explain()}
  {#if doc && showNote}
    <span class="note">
      {doc.note}{#if doc.values?.length}<span class="vals">Values: {doc.values.join(", ")}.</span>{/if}
      <Confidence c={doc.confidence} />
    </span>
  {/if}
  {#each attrs as a (a.k)}
    {#if a.note && attrOpen.has(a.k)}<span class="note"><span class="ak">{a.k}</span>: {a.note}</span>{/if}
  {/each}
{/snippet}

{#if node.kind === "comment"}
  <div class="row c">{node.text}</div>
{:else if inline}
  <div class="row"><span class="w logic">NOT</span> {@render name(inline.tag, "t " + inline.kind)}{@render rest(inline)}</div>
  {@render explain()}
{:else if !kids.length && !WORD[node.tag]}
  <div class="row">{@render name(node.tag, "t " + node.kind)}{@render rest(node)}</div>
  {@render explain()}
{:else}
  {@const label = WORD[node.tag] ?? node.tag}
  {@const cls = WORD[node.tag] ? "w " + node.kind : "t " + node.kind}
  <div class="row head">
    <button type="button" class="fold" aria-expanded={open} aria-label={doc ? (open ? "Fold " : "Unfold ") + label : undefined}
      onclick={() => (flipped = !flipped)}>
      <span class="twist">{open ? "▾" : "▸"}</span>{#if !doc}<span class={cls}>{label}</span>{/if}
    </button>
    {#if doc}{@render name(label, cls)}{/if}
    {@render rest(node)}
    {#if !open}<span class="dimtext more">… {kids.length}</span>{/if}
  </div>
  {@render explain()}
  {#if open}
    <div class="children">
      {#each kids as k, i (i)}<PolicyItem node={k} depth={depth + 1} {comments} />{/each}
    </div>
  {/if}
{/if}

<style>
  .row { display: block; padding: 1px 0; word-break: break-word; }
  .head:hover { background: #eef2f7; }
  button.fold {
    font: inherit; background: none; border: 0; padding: 0; color: inherit;
    text-align: left; cursor: pointer;
  }
  .twist { display: inline-block; width: 14px; color: var(--text-dim); }
  .w { font-weight: bold; }
  .w.branch { color: var(--policy-branch); }
  .w.logic { color: var(--policy-logic); }
  .t { font-weight: bold; }
  .t.condition { color: var(--policy-condition); }
  .t.action { color: var(--policy-action); }
  .t.define { color: var(--policy-define); }
  .t.policy { color: var(--key); }
  button.an { font-weight: normal; }
  .a, .x, .more { margin-left: 0.7ch; }
  .a { color: var(--text-dim); }
  .v { color: #7a2f2f; }
  .x { color: #14442a; }
  .ak { font-style: normal; font-family: var(--mono); }
  .vals { font-style: normal; margin-left: 0.6ch; }
  .c { color: var(--text-dim); font-style: italic; white-space: pre-wrap; font-family: var(--ui); font-size: 10.5px; }
  .children { padding-left: 12px; border-left: 1px dotted #b9b5ac; margin-left: 6px; }
  @media (max-width: 760px) {
    button.fold { min-height: 28px; min-width: 22px; }
  }
</style>
