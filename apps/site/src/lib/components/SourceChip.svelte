<script lang="ts">
  import { getListEntry } from "#lib/api/sources.remote.ts";
  import { link } from "#lib/format.ts";
  import { parseSourceKey, sourceKey, sourcePath } from "@carrier-explode/schema/types";
  import SourceIcon from "./SourceIcon.svelte";

  /** A source by its key, as a chip linking to its page and pictured as the lists picture it. */
  let { source, onclick }: { source: string; onclick?: () => void } = $props();

  const ref = $derived(parseSourceKey(source));
  const entry = $derived(ref ? await getListEntry(sourceKey(ref)) : null);
</script>

{#if ref}
  <a class="chip bundle" href={link(entry?.path ?? sourcePath(ref))} {onclick}>
    {#if entry}<SourceIcon picture={entry.picture} />{/if}{ref.name}
  </a>
{:else}
  <span class="chip">{source}</span>
{/if}
