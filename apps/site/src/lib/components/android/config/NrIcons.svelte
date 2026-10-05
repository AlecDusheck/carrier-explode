<script lang="ts">
  import type { ConfigFormats } from "@carrier-explode/decode-android";
  import EntryTable from "./EntryTable.svelte";

  let { value }: { value: ConfigFormats["nr-icons"] } = $props();
</script>

<EntryTable entries={value} head={["5G state", "Icon"]}>
  {#snippet row(r)}
    <td class="mono">{r.state}</td>
    <td>{r.icon}</td>
  {/snippet}
</EntryTable>
