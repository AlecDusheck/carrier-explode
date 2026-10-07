<script lang="ts">
  import { diffCounts } from "#lib/format.ts";
  import type { SamsungChanges } from "#lib/server/samsung/pack.ts";
  import DiffRows from "../DiffRows.svelte";

  /** Two Samsung versions, file by file and key by key; its sides Before and After unless named. */
  let { changes, left = "Before", right = "After" }: { changes: SamsungChanges; left?: string; right?: string } = $props();
</script>

{#if changes.rows.length}
  <fieldset class="hgroup">
    <legend>{diffCounts(changes.counts)}</legend>
    <DiffRows rows={changes.rows} head="Key" {left} {right} />
  </fieldset>
{:else}
  <p class="dimtext note">No change.</p>
{/if}
