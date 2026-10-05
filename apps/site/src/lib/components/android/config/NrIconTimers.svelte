<script lang="ts">
  import type { ConfigFormats } from "@carrier-explode/decode-android";
  import EntryTable from "./EntryTable.svelte";

  /** The first rule matching a change of 5G state keeps the old icon this long. */
  let { value }: { value: ConfigFormats["nr-icon-timers"] } = $props();
</script>

<EntryTable entries={value} head={["From", "To", "Keep icon"]}>
  {#snippet row(r)}
    <td class="mono">{r.from}</td>
    <td class="mono">{r.to}</td>
    <td class="num">{r.seconds} s</td>
  {/snippet}
</EntryTable>
