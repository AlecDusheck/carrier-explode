<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Folding } from "$lib/ui-state.svelte";

  let { filter = $bindable(), notes = $bindable(), fold, name, label, children }: {
    filter: string;
    notes: boolean;
    fold: Folding;
    /** The filter field's form name and accessible label. */
    name: string;
    label: string;
    /** More buttons, after the shared ones. */
    children?: Snippet;
  } = $props();
</script>

<div class="filters">
  <input type="search" {name} placeholder="filter" aria-label={label} bind:value={filter} />
  <button class="btn" onclick={() => fold.expandAll()}>Expand</button>
  <button class="btn" onclick={() => fold.collapseAll()}>Collapse</button>
  <button class="btn" class:on={notes} aria-pressed={notes} onclick={() => (notes = !notes)}>{notes ? "Hide notes" : "Show notes"}</button>
  {@render children?.()}
</div>
