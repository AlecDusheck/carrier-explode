<!-- A bundle named in a wiki article, linked to its current version. `version` also
     prints that version; `file` links one of its files instead of the bundle. -->
<script lang="ts">
  import { getHead } from "#lib/api/bundles.remote.ts";
  import { bundleHref, fileHref } from "#lib/format.ts";
  import type { Kind } from "#lib/types.ts";

  let { name, kind = "carriers", version = false, file }: { name: string; kind?: Kind; version?: boolean; file?: string } = $props();

  const head = $derived(await getHead({ kind, name }));
</script>

{#if file}
  <a href={fileHref(kind, name, head.slug, file)}><code>{file}</code></a>
{:else}
  <a href={bundleHref(kind, name, head.slug)}><code>{name}</code>{#if version}&nbsp;{head.build}{/if}</a>
{/if}
