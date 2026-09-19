<script lang="ts">
  import { page } from "$app/state";
  import { errorMessage } from "$lib/format";

  let { error, reset, quiet }: { error: unknown; reset: () => void; quiet: boolean } = $props();

  // The banner shows one line of it; the console keeps the whole thing, which is
  // what anyone debugging a failed pane actually needs. The server side already
  // logs unexpected errors on its own.
  $effect(() => console.error("[pane]", page.url.pathname, error));

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
