<!-- The bundles holding a value, as links: a few by name, then how many more. -->
<script lang="ts">
  import { bundleHref } from "#lib/format.ts";
  import type { Kind } from "#lib/types.ts";

  const SHOWN = 3;
  let { names, kind }: { names: string[]; kind: Kind } = $props();
</script>

{#each names.slice(0, SHOWN) as n, i (n)}{i ? ", " : ""}<a href={bundleHref(kind, n)}><code>{n}</code></a>{/each}{#if names.length > SHOWN}&nbsp;and {names.length - SHOWN} more{/if}
