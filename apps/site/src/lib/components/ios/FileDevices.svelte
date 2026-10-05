<script lang="ts">
  import type { NamedBoard } from "#lib/apple/phones.ts";
  import DeviceNames from "./DeviceNames.svelte";

  /** The phones a bundle member is for, as its name gives them. */
  let { devices }: { devices: readonly NamedBoard[] | undefined } = $props();
</script>

{#if devices?.length}
  <div class="filters">
    <span class="dimtext"><DeviceNames {devices} /></span>
  </div>
{/if}
