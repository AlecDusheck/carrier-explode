<script lang="ts">
  import type { Snippet } from "svelte";
  import type { TreeState } from "#lib/ui-state.svelte.ts";

  let { state, json = true, label = "filter keys and values", children }: {
    state: TreeState;
    /** The JSON toggle, for views that are one tree. */
    json?: boolean;
    label?: string;
    /** More buttons, after the shared ones. */
    children?: Snippet;
  } = $props();
</script>

<div class="filters">
  <input type="search" name="tree-filter" placeholder="filter" aria-label={label} bind:value={state.filter} />
  <button class="btn" onclick={() => state.fold.expandAll()}>Expand</button>
  <button class="btn" onclick={() => state.fold.collapseAll()}>Collapse</button>
  <button class="btn" class:on={state.notes} aria-pressed={state.notes} onclick={() => (state.notes = !state.notes)}>{state.notes ? "Hide notes" : "Show notes"}</button>
  {#if json}<button class="btn" class:on={state.raw} aria-pressed={state.raw} onclick={() => (state.raw = !state.raw)}>JSON</button>{/if}
  {@render children?.()}
</div>
