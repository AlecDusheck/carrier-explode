<script lang="ts">
  import type { Snippet } from "svelte";
  import type { TreeState } from "#lib/ui-state.svelte.ts";

  let { state, label = "filter keys and values", children }: {
    state: TreeState;
    label?: string;
    /** More buttons, after the filter. */
    children?: Snippet;
  } = $props();
</script>

<div class="filters">
  <input type="search" name="tree-filter" placeholder="filter" aria-label={label} bind:value={state.filter} />
  {@render children?.()}
</div>
