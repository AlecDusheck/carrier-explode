<script lang="ts">
  import { getListEntry } from "#lib/api/sources.remote.ts";
  import { link } from "#lib/format.ts";
  import type { ChipEntry } from "#lib/server/lists.ts";
  import { parseSourceKey, sourceKey, sourcePath } from "@carrier-explode/schema/types";
  import SourceIcon from "./SourceIcon.svelte";
  import SourceName from "./SourceName.svelte";

  /** A source as a chip linking to its page, pictured and tagged as the lists picture and tag it; a bare key is looked up. */
  let { source, onclick }: { source: string | ChipEntry; onclick?: () => void } = $props();

  const ref = $derived(parseSourceKey(typeof source === "string" ? source : source.key));
  const entry = $derived(typeof source !== "string" ? source : ref ? await getListEntry(sourceKey(ref)) : null);
</script>

{#if ref}
  <a class="chip bundle" href={link(entry?.path ?? sourcePath(ref))} {onclick}>
    {#if entry}<SourceIcon picture={entry.picture} />{/if}<SourceName brand={entry?.brand ?? ref.name} code={ref.name} />{#if entry?.tag}<span class="source-code dimtext mono">{entry.tag}</span>{/if}
  </a>
{:else}
  <span class="chip">{typeof source === "string" ? source : source.key}</span>
{/if}
