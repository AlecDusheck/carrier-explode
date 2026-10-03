<script lang="ts">
  import { sourceHref } from "#lib/format.ts";
  import { parseSourceKey } from "#lib/schema/types.ts";
  import SourceIcon from "./SourceIcon.svelte";

  /** A source by its key, as a chip linking to it (at a version, or at its head). */
  interface Props {
    source: string;
    version?: string | undefined;
    tone?: "good" | "bad" | undefined;
    onclick?: (() => void) | undefined;
  }

  let { source, version, tone, onclick }: Props = $props();

  const ref = $derived(parseSourceKey(source));
  const name = $derived(ref ? ref.name + (ref.family ? ` (${ref.family})` : "") : source);
</script>

<a class="chip bundle {tone ?? ''}" href={sourceHref(source, version ? { version } : {})} {onclick}>
  {#if ref?.platform === "ios" && ref.kind === "carrier"}<SourceIcon name={ref.name} bundle={ref.name} />{/if}
  {name}
</a>
