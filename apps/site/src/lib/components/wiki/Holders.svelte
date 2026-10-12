<!-- The sources holding a value, as chips: a few, then how many more. -->
<script lang="ts">
  import type { SourceKey } from "@carrier-explode/schema/types";
  import SourceChip from "../SourceChip.svelte";

  const SHOWN = 3;
  let { sources }: { sources: readonly SourceKey[] } = $props();
</script>

{#each sources.slice(0, SHOWN) as source (source)}<SourceChip {source} />{/each}{#if sources.length > SHOWN}&nbsp;and {sources.length - SHOWN} more{/if}
