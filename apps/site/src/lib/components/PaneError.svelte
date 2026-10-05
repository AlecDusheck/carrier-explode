<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { errorMessage } from "#lib/format.ts";

  let { error, reset, quiet }: { error: unknown; reset: () => void; quiet: boolean } = $props();

  // A failed boundary stays failed. Moving to another URL should try again with the new inputs.
  const failedAt = page.url.href;
  afterNavigate(({ to }) => {
    if (to && to.url.href !== failedAt) reset();
  });
</script>

{#if !quiet}
  <div class="banner err pane-err">
    <span class="grow">{errorMessage(error)}</span>
    <button class="btn" onclick={reset}>Retry</button>
  </div>
{/if}
