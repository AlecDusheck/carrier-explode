<script lang="ts">
  import type { Snippet } from "svelte";
  import { browser } from "$app/env";
  import { page } from "$app/state";
  import PaneError from "./PaneError.svelte";

  let { children, quiet = false }: { children: Snippet; quiet?: boolean } = $props();

  // The banner shows one line of it; the console keeps the whole thing, which is what
  // anyone debugging a failed pane needs. The server already logs unexpected errors itself.
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
  {@render children()}
</svelte:boundary>
