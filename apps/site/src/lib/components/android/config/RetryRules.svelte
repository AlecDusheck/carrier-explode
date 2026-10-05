<script lang="ts">
  import type { ConfigFormats } from "@carrier-explode/decode-android";
  import EntryTable from "./EntryTable.svelte";

  let { value }: { value: ConfigFormats["retry-rules"] } = $props();

  const wait = (ms: number): string => (ms < 60_000 ? `${ms / 1000}\u00a0s` : `${ms / 60_000}\u00a0min`);
</script>

<EntryTable entries={value} head={["For", "Fail causes", "Retry after", "Retries"]}>
  {#snippet row(r)}
    <td>{r.capabilities.length ? r.capabilities.join(", ") : "the failed request"}</td>
    <td>
      {r.failCauses.length ? r.failCauses.join(", ") : "any"}
      {#if r.permanent}<span class="chip bad" title="No timed retry on this APN; the wait is before the next APN">permanent</span>{/if}
    </td>
    <td>
      {r.intervalsMs.map(wait).join(", ")}
      {#if r.ignored.length}<div class="dimtext">ignored: {r.ignored.join(", ")}</div>{/if}
    </td>
    <td class="num">{r.maxRetries}</td>
  {/snippet}
</EntryTable>
