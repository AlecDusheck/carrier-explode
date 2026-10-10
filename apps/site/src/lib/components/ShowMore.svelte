<script lang="ts">
  /** The foot of a list drawn a page at a time: how much of it is drawn, and the next page on a click. */
  let { shown, total, more }: { shown: number; total: number; more: () => void } = $props();
</script>

{#if shown < total}
  <p class="more">
    <button type="button" class="btn" onclick={more}>Show more</button>
    <span class="dimtext">{shown} of {total}</span>
  </p>
{/if}

<style>
  .more { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
</style>
