<script lang="ts">
  import type { Snippet } from "svelte";
  import { browser } from "$app/environment";
  import PaneError from "./PaneError.svelte";

  let { children, quiet = false }: { children: Snippet; quiet?: boolean } = $props();
</script>

{#snippet loading()}
  {#if !quiet}<p class="pane-msg dimtext">Loading…</p>{/if}
{/snippet}

{#snippet failure(error: unknown, reset: () => void)}
  <PaneError {error} {reset} {quiet} />
{/snippet}

<!-- A boundary with a pending snippet renders only that snippet during SSR. Leaving it
     undefined on the server makes SSR wait for the data; hydration follows what was sent. -->
<svelte:boundary pending={browser ? loading : undefined} failed={failure}>
  {@render children()}
</svelte:boundary>
