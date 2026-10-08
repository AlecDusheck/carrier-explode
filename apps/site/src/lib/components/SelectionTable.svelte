<script lang="ts">
  import { selectionRows, type SelectionRule } from "#lib/settings.ts";

  /** The SIMs a bundle or a modem configuration is selected by. */
  let { rules }: { rules: readonly SelectionRule[] } = $props();

  const rows = $derived(selectionRows(rules));
  const mixed = $derived(new Set(rows.map((r) => r.via)).size > 1);
</script>

<table class="grid">
  <thead><tr>{#if mixed}<th>By</th>{/if}<th>Which SIMs</th><th>{mixed ? "Values" : rows[0]?.via}</th></tr></thead>
  <tbody>
    {#each rows as r, i (i)}
      <tr>{#if mixed}<td>{r.via}</td>{/if}<td>{r.match}</td><td class="mono keys">{r.keys.join(", ")}</td></tr>
    {/each}
  </tbody>
</table>

<style>
  .keys { white-space: normal; overflow-wrap: anywhere; }
</style>
