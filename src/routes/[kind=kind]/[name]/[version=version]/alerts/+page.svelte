<script lang="ts">
  import { getCbs } from "#lib/api/tables.remote.ts";
  import { cbsEntryLabel } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import CbsCountry from "#lib/components/ios/CbsCountry.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    {@const data = await getCbs()}
    {@const row = data.rows.find((r) => r.country === params.name)}
    {#if row}
      <p class="dimtext note">From {cbsEntryLabel(row, data.image)}, the copy every phone in the country gets.</p>
      <CbsCountry {row} />
    {:else}
      <p class="dimtext note">No cell broadcast configuration for {params.name}.</p>
    {/if}
  </Pane>
</div>
