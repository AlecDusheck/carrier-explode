<script lang="ts">
  import { getAlerts } from "#lib/api/ios.remote.ts";
  import type { TabProps } from "#lib/types.ts";
  import CbsCountry from "../CbsCountry.svelte";

  let { at }: TabProps = $props();

  const row = $derived(await getAlerts({ source: at.source, slug: at.version }));
</script>

{#if row}
  <CbsCountry {row} />
{:else}
  <p class="dimtext note">No carrier.plist, so no cell broadcast configuration.</p>
{/if}
