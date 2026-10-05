<script lang="ts">
  import type { ConfigFormats } from "@carrier-explode/decode-android";
  import EntryTable from "./EntryTable.svelte";

  /** Apps signed with these certificates get carrier privileges. */
  let { value }: { value: ConfigFormats["certificates"] } = $props();
</script>

<EntryTable entries={value} head={["Certificate", "Apps"]}>
  {#snippet row(r)}
    <td><span class="dimtext">{r.digest}</span> <span class="mono breakall">{r.hash}</span></td>
    <td class="mono">{r.packages.length ? r.packages.join(", ") : "any signed with it"}</td>
  {/snippet}
</EntryTable>
