<script lang="ts">
  import { page } from "$app/state";
  import { errorMessage } from "$lib/format";

  let { error, reset, quiet }: { error: unknown; reset: () => void; quiet: boolean } = $props();

  // Observability keeps worker logs, so put the thing itself where it can be
  // read: the banner only ever shows a line of it.
  console.error("[pane]", page.url.pathname, error);

  // A failed boundary stays failed. Moving to another URL should try again with the new inputs.
  const failedAt = page.url.href;
  $effect(() => {
    if (page.url.href !== failedAt) reset();
  });
</script>

{#if !quiet}
  <div class="banner err pane-err">
    <span class="grow">{errorMessage(error)}</span>
    <button class="btn" onclick={reset}>Retry</button>
  </div>
{/if}
