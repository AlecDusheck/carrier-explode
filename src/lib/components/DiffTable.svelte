<script lang="ts">
  import type { DiffRow } from "$lib/server/diff";
  import { shortValue } from "$lib/format";

  let { rows, left = "Before", right = "After" }: { rows: DiffRow[]; left?: string; right?: string } = $props();
</script>

<table class="grid">
  <thead><tr><th>Key path</th><th>{left}</th><th>{right}</th></tr></thead>
  <tbody>
    {#each rows as r, i (i)}
      <tr>
        <td class="mono k wrap">
          {r.path}
          <span class="chip {r.kind === 'added' ? 'good' : r.kind === 'removed' ? 'bad' : 'warn'}">{r.kind}</span>
        </td>
        <td class="mono wrap">{shortValue(r.a, 300)}</td>
        <td class="mono wrap">{shortValue(r.b, 300)}</td>
      </tr>
    {/each}
  </tbody>
</table>
