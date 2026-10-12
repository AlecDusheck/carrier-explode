<script lang="ts">
  import { getListEntry } from "#lib/api/sources.remote.ts";
  import { link } from "#lib/format.ts";
  import type { ChipEntry } from "#lib/server/lists.ts";
  import { sourceOf, sourcePath, type SourceKey } from "@carrier-explode/schema/types";
  import SourceIcon from "./SourceIcon.svelte";
  import SourceName from "./SourceName.svelte";

  /** A source as a chip linking to its page, pictured and tagged as the lists picture and tag it; a bare key is looked up. */
  let { source, onclick }: { source: SourceKey | ChipEntry; onclick?: () => void } = $props();

  const ref = $derived(sourceOf(typeof source === "string" ? source : source.key));
  const entry = $derived(typeof source === "string" ? await getListEntry(source) : source);
</script>

<a class="chip bundle" href={link(entry?.path ?? sourcePath(ref))} {onclick}>
  {#if entry}<SourceIcon picture={entry.picture} />{/if}<SourceName brand={entry?.brand ?? ref.name} code={ref.name} />{#if entry?.tag}<span class="source-code dimtext mono">{entry.tag}</span>{/if}
</a>
