<script lang="ts">
  import type { SelectionRule } from "#lib/settings.ts";

  /** The SIMs a bundle or a modem configuration is selected by. */
  let { rules }: { rules: readonly SelectionRule[] } = $props();
</script>

<table class="grid">
  <thead><tr><th>By</th><th>Value</th><th>Which SIMs</th></tr></thead>
  <tbody>
    {#each rules as r, i (i)}
      <tr><td>{r.via}</td><td class="mono">{r.key}</td><td>{r.match ?? ""}</td></tr>
    {/each}
  </tbody>
</table>
