<script lang="ts">
  import { page } from "$app/state";
  import { link } from "#lib/format.ts";
  import { PLATFORM_ORDER } from "#lib/platforms.ts";
  import { listPath } from "@carrier-explode/schema/types";
</script>

<div class="view">
  <div class="scroll pad">
    <div class="banner err">{page.status} &middot; {page.error?.message}</div>
    {#if page.error?.elsewhere}
      <a class="btn" href={link(page.error.elsewhere)}>This bundle's versions</a>
    {:else}
      <a class="btn" href={link(listPath(PLATFORM_ORDER[0], "carrier"))}>Carriers</a>
    {/if}
  </div>
</div>
