<script module lang="ts">
  import type { Awaiting } from "./Busy.svelte";

  const INDEX: Awaiting = { kind: "index" };
  const UPDATE: Awaiting = { kind: "update" };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { browser } from "$app/env";
  import { page } from "$app/state";
  import { isHttpError } from "@sveltejs/kit";
  import Busy from "./Busy.svelte";
  import PaneError from "./PaneError.svelte";

  let { children, quiet = false, awaiting = INDEX }: { children: Snippet; quiet?: boolean; awaiting?: Awaiting } = $props();

  // An HTTP error is the server's answer, which the banner shows and the server logs when unexpected.
  // Only a failure in the browser itself keeps its whole error in the console.
  const log = (error: unknown) => {
    if (browser && !isHttpError(error)) console.error("[pane]", page.url.pathname, error);
  };
</script>

{#snippet loading()}
  {#if !quiet}<p class="pane-msg dimtext"><Busy {awaiting} /></p>{/if}
{/snippet}

{#snippet failure(error: unknown, reset: () => void)}
  <PaneError {error} {reset} {quiet} />
{/snippet}

<!-- A boundary with a pending snippet renders only that snippet during SSR. Leaving it
     undefined on the server makes SSR wait for the data; hydration follows what was sent. -->
<svelte:boundary pending={browser ? loading : undefined} failed={failure} onerror={log}>
  <!-- Inside the boundary, $effect.pending() counts its awaits; the pending snippet covers the first load. -->
  {@const updating = $effect.pending() > 0}
  <div class="pane-body" aria-busy={updating || undefined}>
    {#if updating && !quiet}<span class="pane-updating"><Busy awaiting={UPDATE} /></span>{/if}
    {@render children()}
  </div>
</svelte:boundary>

<style>
  /* A pane's wrapper takes no box: its children lay out in the pane's parent. */
  .pane-body {
    display: contents;
  }
  .pane-body > :global(*) {
    transition: opacity 0.15s;
  }
  .pane-body[aria-busy="true"] > :global(:not(.pane-updating)) {
    opacity: 0.5;
    cursor: progress;
    transition-delay: 150ms;
  }
  /* Absolute with no offsets: drawn where it would sit, over the stale content, taking no room. */
  .pane-updating {
    position: absolute;
    z-index: 5;
    padding: 1px 6px;
    font-size: 11px;
    pointer-events: none;
    background: var(--face-hi);
    border: 1px solid;
    border-color: var(--bevel-out);
    animation: busy-in 0s 150ms backwards;
  }
</style>
