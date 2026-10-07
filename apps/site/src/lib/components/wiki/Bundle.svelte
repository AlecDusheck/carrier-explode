<!-- An iOS bundle named in a wiki article, linked to its newest version. `version` also
     prints that version; `file` links one of its files instead. -->
<script lang="ts">
  import { getListEntry, getSourceHead } from "#lib/api/sources.remote.ts";
  import { link } from "#lib/format.ts";
  import { SEGMENT_KIND, sourceKey, versionPath, type KindSegment, type SourceRef } from "@carrier-explode/schema/types";
  import Live from "./Live.svelte";

  let { name, kind = "carriers", version = false, file }: { name: string; kind?: KindSegment; version?: boolean; file?: string } = $props();

  const ref: SourceRef<"ios"> = $derived({ platform: "ios", kind: SEGMENT_KIND[kind], name });
</script>

<Live>
  {#if await getListEntry(sourceKey(ref))}
    {@const head = await getSourceHead({ source: sourceKey(ref) })}
    {@const at = versionPath(ref, { line: head.line, slug: head.entry.slug })}
    {#if file}
      <a href={link(`${at}/files/${file}`)}><code>{file}</code></a>
    {:else}
      <a href={link(at)}><code>{name}</code>{#if version}&nbsp;{head.entry.version}{/if}</a>
    {/if}
  {:else}
    <code class="dimtext" title="Not in the index">{file ?? name}</code>
  {/if}
</Live>
