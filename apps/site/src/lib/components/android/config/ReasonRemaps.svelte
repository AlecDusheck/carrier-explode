<script lang="ts">
  import type { ConfigFormats } from "@carrier-explode/decode-android";
  import EntryTable from "./EntryTable.svelte";

  /** ImsReasonInfo codes: a call ending with this code and message reports the new code. */
  let { value }: { value: ConfigFormats["reason-remaps"] } = $props();
</script>

<EntryTable entries={value} head={["Code", "Message", "Becomes"]}>
  {#snippet row(r)}
    <td class="num">{r.from ?? "any"}</td>
    <td>{r.message === null ? "any" : `"${r.message}"`}</td>
    <td class="num">{r.to}</td>
  {/snippet}
</EntryTable>
