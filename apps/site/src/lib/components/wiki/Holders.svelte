<!-- The sources holding a value, as links: a few by name, then how many more. -->
<script lang="ts">
  import { link } from "#lib/format.ts";
  import { parseSourceKey, sourcePath } from "@carrier-explode/schema/types";

  const SHOWN = 3;
  let { sources }: { sources: readonly string[] } = $props();

  const refs = $derived(sources.flatMap((s) => parseSourceKey(s) ?? []));
</script>

{#each refs.slice(0, SHOWN) as r, i (r.name)}{i ? ", " : ""}<a href={link(sourcePath(r))}><code>{r.name}</code></a>{/each}{#if refs.length > SHOWN}&nbsp;and {refs.length - SHOWN} more{/if}
