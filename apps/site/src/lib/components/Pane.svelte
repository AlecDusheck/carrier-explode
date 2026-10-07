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
