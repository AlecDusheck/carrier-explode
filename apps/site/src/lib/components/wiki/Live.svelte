<!-- A live value inside an article: one that cannot be read shows a dash, with the reason on hover, and the article stands. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { errorMessage } from "#lib/format.ts";

  let { children }: { children: Snippet } = $props();
</script>

<svelte:boundary>
  {@render children()}
  {#snippet failed(error)}<span class="dimtext" title={errorMessage(error)}>—</span>{/snippet}
</svelte:boundary>
