<script lang="ts">
  import { page } from "$app/state";
  import { routineReason } from "#lib/apple/routine-changes.ts";
  import { versionHref, withParams } from "#lib/format.ts";
  import type { NativeComparison } from "#lib/server/compare.ts";
  import BundleCompare from "./BundleCompare.svelte";

  /** Two Apple bundles file by file, as /compare shows them; `?file=` narrows to one. */
  let { comparison }: { comparison: NativeComparison<"apple"> } = $props();

  const file = $derived(page.url.searchParams.get("file"));
</script>

{#if comparison.a && comparison.diff}
  {@const sides = { a: comparison.a, b: comparison.b }}
  {@const diff = comparison.diff}
  <BundleCompare
    {diff}
    fileHref={(s, path) => versionHref({ ...sides[s], version: sides[s].entry.slug }, "files", diff.aliases[path]?.[s] ?? path)}
    left="Left"
    right="Right"
    narrowHref={(path) => withParams(page.url, { file: path })}
    routine={file ? undefined : (f) => routineReason(f)}
  />
{/if}
