<script lang="ts">
  import type { ConfigFormats } from "@carrier-explode/decode-android";
  import EntryTable from "./EntryTable.svelte";

  /** The first rule matching a handover decides it. */
  let { value }: { value: ConfigFormats["handover-rules"] } = $props();
</script>

<EntryTable entries={value} head={["Handover", "From", "To", "For", "When"]}>
  {#snippet row(r)}
    <td><span class="chip {r.type === 'allowed' ? 'good' : 'bad'}">{r.type}</span></td>
    <td>{r.source.join(", ")}</td>
    <td>{r.target.join(", ")}</td>
    <td>{r.capabilities.length ? r.capabilities.join(", ") : "any"}</td>
    <td>{r.roamingOnly ? "roaming" : "always"}</td>
  {/snippet}
</EntryTable>
