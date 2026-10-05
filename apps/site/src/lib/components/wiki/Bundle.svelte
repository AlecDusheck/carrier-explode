<!-- An iOS bundle named in a wiki article, linked to its newest version. `version` also
     prints that version; `file` links one of its files instead. -->
<script lang="ts">
  import { getSourceHead } from "#lib/api/sources.remote.ts";
  import { link } from "#lib/format.ts";
  import { SEGMENT_KIND, sourceKey, versionPath, type KindSegment, type SourceRef } from "@carrier-explode/schema/types";

  let { name, kind = "carriers", version = false, file }: { name: string; kind?: KindSegment; version?: boolean; file?: string } = $props();

  const ref: SourceRef<"ios"> = $derived({ platform: "ios", kind: SEGMENT_KIND[kind], name });
  const head = $derived(await getSourceHead({ source: sourceKey(ref) }));
  const at = $derived(versionPath(ref, { line: head.line, slug: head.entry.slug }));
</script>

{#if file}
  <a href={link(`${at}/files/${file}`)}><code>{file}</code></a>
{:else}
  <a href={link(at)}><code>{name}</code>{#if version}&nbsp;{head.entry.version}{/if}</a>
{/if}
