<script lang="ts">
  import { PLATFORM_NOTICES } from "#lib/platforms.ts";

  let { params, children } = $props();

  const notice = $derived(PLATFORM_NOTICES[params.platform]);
</script>

{#if notice}
  <div class="noticed">
    <div class="banner notice">{notice}</div>
    {@render children()}
  </div>
{:else}
  {@render children()}
{/if}

<style>
  .noticed { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .notice { margin: 6px 6px 0; flex: none; }
</style>
