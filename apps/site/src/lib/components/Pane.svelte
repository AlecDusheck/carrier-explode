<script lang="ts">
  import type { Snippet } from "svelte";
  import { browser } from "$app/env";
  import { page } from "$app/state";
  import PaneError from "./PaneError.svelte";

  let { children, quiet = false }: { children: Snippet; quiet?: boolean } = $props();

  // The banner shows one line; the console keeps the whole error for debugging.
  // The server logs unexpected errors itself.
  const log = (error: unknown) => {
    if (browser) console.error("[pane]", page.url.pathname, error);
  };
</script>

{#snippet loading()}
  {#if !quiet}<p class="pane-msg dimtext">Loading…</p>{/if}
{/snippet}

{#snippet failure(error: unknown, reset: () => void)}
  <PaneError {error} {reset} {quiet} />
{/snippet}

<!-- A boundary with a pending snippet renders only that snippet during SSR. Leaving it
     undefined on the server makes SSR wait for the data; hydration follows what was sent. -->
<svelte:boundary pending={browser ? loading : undefined} failed={failure} onerror={log}>
  <!-- Inside the boundary, $effect.pending() counts its awaits; the pending snippet covers the first load.
       The wrapper is display: contents, so a pane's children lay out as before. -->
  {@const updating = $effect.pending() > 0}
  <div class="pane-body" aria-busy={updating || undefined}>
    {#if updating && !quiet}<span class="pane-updating" role="status">Updating…</span>{/if}
    {@render children()}
  </div>
</svelte:boundary>
