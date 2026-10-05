<script lang="ts">
  import { PLATFORM_NOTICES } from "#lib/platforms.ts";

  let { params, children } = $props();

  const notice = $derived(PLATFORM_NOTICES[params.platform]);
</script>

{#if notice}<div class="banner notice">{notice}</div>{/if}
{@render children()}

<style>
  .notice { margin: 6px 6px 0; }
</style>
