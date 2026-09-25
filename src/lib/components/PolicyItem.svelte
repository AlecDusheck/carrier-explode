<script lang="ts" module>
  import type { PolicyNode } from "$lib/decode/policy";

  /** The first node of each tag, and of each tag@attribute, in document order. */
  export interface NoteFirsts { el: Record<string, PolicyNode>; attr: Record<string, PolicyNode> }
</script>

<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { describePolicyAttr, describePolicyElement } from "$lib/decode/policyman";
  import Confidence from "./Confidence.svelte";
  import PolicyItem from "./PolicyItem.svelte";

  let { node, depth = 0, comments, notes = false, firsts }: {
    node: PolicyNode; depth?: number; comments: boolean; notes?: boolean; firsts?: NoteFirsts;
  } = $props();

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
  const flip = (k: string) => (attrOpen.has(k) ? attrOpen.delete(k) : attrOpen.add(k));

  const kids = $derived(node.children.filter((c) => comments || c.kind !== "comment"));
  // NOT over a single leaf reads as one line.
  const inline = $derived(node.tag === "not" && kids.length === 1 && !kids[0].children.length ? kids[0] : null);
  // The element whose name this row shows.
  const shown = $derived(inline ?? node);
  const doc = $derived(PLAIN.has(shown.tag) ? undefined : describePolicyElement(shown.tag));
  const attrs = $derived(Object.entries(shown.attrs).map(([k, v]) => ({
    k, v, note: describePolicyAttr(shown.tag, k), first: !firsts || firsts.attr[shown.tag + "@" + k] === shown,
  })));
  // With notes on, repeats stay tappable but only the first of each is explained.
  const noteOn = $derived(showNote || (notes && (!firsts || firsts.el[shown.tag] === shown)));
  const attrOn = (a: { k: string; first: boolean }) => attrOpen.has(a.k) || (notes && a.first);

</script>

{#snippet name(label: string, cls: string)}
  {#if doc}
    <!-- The name is the control: tap or click for its note. -->
    <button type="button" class="{cls} doc" class:on={noteOn} aria-expanded={noteOn}
      onclick={() => (showNote = !showNote)}>{label}</button>
  {:else}
    <span class={cls}>{label}</span>
  {/if}
{/snippet}

{#snippet rest(n: PolicyNode)}
  {#each attrs as a (a.k)}
    <span class="a">{#if a.note}<button type="button" class="an doc" class:on={attrOn(a)} aria-expanded={attrOn(a)}
        onclick={() => flip(a.k)}>{a.k}</button>{:else}{a.k}{/if}=<span class="v">{a.v}</span></span>
  {/each}
  {#if n.text}<span class="x">{n.text}</span>{/if}
{/snippet}

{#snippet explain()}
  {#if doc && noteOn}
    <span class="note">
      {doc.note}{#if doc.values?.length}<span class="vals">Values: {doc.values.join(", ")}.</span>{/if}
      <Confidence c={doc.confidence} />
    </span>
  {/if}
  {#each attrs as a (a.k)}
    {#if a.note && attrOn(a)}<span class="note"><span class="ak">{a.k}</span>: {a.note}</span>{/if}
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
      {#each kids as k, i (i)}<PolicyItem node={k} depth={depth + 1} {comments} {notes} {firsts} />{/each}
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
  .w.branch { color: #6a2f8a; }
  .w.logic { color: #8a4a14; }
  .t { font-weight: bold; }
  .t.condition { color: #1f3f8a; }
  .t.action { color: #14632a; }
  .t.define { color: #6a2f8a; }
  .t.policy { color: #1b3d6b; }
  .doc {
    font: inherit; font-weight: bold; color: inherit; background: none; border: 0; padding: 0;
    text-decoration: underline dotted #8a93a6; text-underline-offset: 3px; cursor: help;
  }
  .doc.on { text-decoration-style: solid; }
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
    .doc { padding: 6px 0; margin: -6px 0; }
  }
</style>
