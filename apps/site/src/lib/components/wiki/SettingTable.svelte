<!-- Settings with the bundle holding the largest value of each, against the median:
     a table that stays true as bundles change, read from the index's settings rows. -->
<script lang="ts">
  import { getSettingSummary } from "#lib/api/scan.remote.ts";
  import Holders from "./Holders.svelte";
  import Live from "./Live.svelte";

  type Row = { path: string; note?: string; scope?: "carriers" | "countries"; file?: string };
  let { rows }: { rows: readonly Row[] } = $props();

  const summary = (r: Row): ReturnType<typeof getSettingSummary> =>
    getSettingSummary({ platform: "ios", path: r.path, file: r.file ?? "carrier.plist", scope: r.scope ?? "carriers" });
</script>

<table>
  <thead><tr><th>Key</th><th>Largest</th><th>Held by</th><th>Median</th><th>Bundles</th></tr></thead>
  <tbody>
    {#each rows as r (r.path)}
      <tr>
        <td><code>{r.path}</code>{#if r.note}<br /><span class="dimtext">{r.note}</span>{/if}</td>
        <td><Live>{(await summary(r)).max?.value ?? "—"}</Live></td>
        <td><Live>{@const max = (await summary(r)).max}{#if max}<Holders sources={max.sources} />{/if}</Live></td>
        <td><Live>{(await summary(r)).median ?? "—"}</Live></td>
        <td><Live>{(await summary(r)).set}</Live></td>
      </tr>
    {/each}
  </tbody>
</table>
