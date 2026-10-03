<script lang="ts">
  import { getAlerts } from "#lib/api/bundles.remote.ts";
  import { verArgs } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import CbsCountry from "../CbsCountry.svelte";

  let { at }: TabProps = $props();

  const row = $derived(await getAlerts(verArgs(at)));
</script>

{#if row}
  <CbsCountry {row} />
{:else}
  <p class="dimtext note">No carrier.plist, so no cell broadcast configuration.</p>
{/if}
