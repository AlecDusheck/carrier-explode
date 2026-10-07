<script lang="ts">
  import { versionTag } from "#lib/format.ts";
  import type { Version } from "#lib/types.ts";
  import Picker from "./Picker.svelte";
  import VersionMark from "./VersionMark.svelte";

  interface Props {
    label?: string | undefined;
    timeline: readonly Version[];
    current: string;
    /** The version a device on a release runs now. */
    head: string;
    href: (slug: string) => string;
  }

  let { label, timeline, current, head, href }: Props = $props();

  const active = $derived(timeline.find((e) => e.slug === current));
</script>

{#snippet option(e: Version)}
  {@const tag = versionTag(e, head)}
  <span class="picker-opt">
    <VersionMark platform={e.platform} version={e.icon} />
    <span class="text">{e.label}</span>
    {#if tag}<span class={["picker-tag", { now: tag === "current release" }]}>{tag}</span>{/if}
    {#if !e.changed && e.slug !== current}<span class="picker-tag">same content</span>{/if}
  </span>
{/snippet}

<Picker {label} items={timeline} selected={active} key={(e) => e.slug} {option} href={(e) => href(e.slug)} />
