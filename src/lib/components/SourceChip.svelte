<script lang="ts">
  import { link } from "#lib/format.ts";
  import { parseSourceKey, sourcePath, versionPath } from "#lib/schema/types.ts";
  import SourceIcon from "./SourceIcon.svelte";

  /** A source by its key, as a chip linking to its page (at a version, or at its head). */
  interface Props {
    source: string;
    version?: string | undefined;
    tone?: "good" | "bad" | undefined;
    onclick?: (() => void) | undefined;
  }

  let { source, version, tone, onclick }: Props = $props();

  const ref = $derived(parseSourceKey(source));
</script>

{#if ref}
  <a class="chip bundle {tone ?? ''}" href={link(version ? versionPath(ref, version) : sourcePath(ref))} {onclick}>
    <SourceIcon name={ref.name} bundle={ref.name} />{ref.name}
  </a>
{:else}
  <span class="chip">{source}</span>
{/if}
