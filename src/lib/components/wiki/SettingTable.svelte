<!-- Settings with the bundle holding the largest value of each, against the median:
     a table that stays true as bundles change, read from the key-scan index. -->
<script lang="ts">
  import { getSettingSummary } from "#lib/api/tables.remote.ts";
  import Holders from "./Holders.svelte";

  type Row = { path: string; note?: string; scope?: string; file?: string };
  let { rows }: { rows: Row[] } = $props();
</script>

<table>
  <thead><tr><th>Key</th><th>Largest</th><th>Held by</th><th>Median</th><th>Bundles</th></tr></thead>
  <tbody>
    {#each rows as r (r.path)}
      {@const scope = r.scope ?? "carriers"}
      {@const s = await getSettingSummary({ path: r.path, file: r.file ?? "carrier.plist", scope })}
      <tr>
        <td><code>{r.path}</code>{#if r.note}<br /><span class="dimtext">{r.note}</span>{/if}</td>
        <td>{s.max?.value ?? "-"}</td>
        <td>{#if s.max}<Holders names={s.max.names} kind={scope === "countries" ? "countries" : "carriers"} />{/if}</td>
        <td>{s.median ?? "-"}</td>
        <td>{s.set}</td>
      </tr>
    {/each}
  </tbody>
</table>
