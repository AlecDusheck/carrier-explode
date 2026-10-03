<script lang="ts">
  import { entryLabel } from "#lib/format.ts";
  import type { Version } from "#lib/types.ts";
  import { VERSION_ICONS } from "./icons";
  import Picker from "./Picker.svelte";

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
  {@const Icon = VERSION_ICONS[e.platform]}
  <span class="picker-opt">
    <Icon version={e.images.at(-1) ?? e.ota[0]} />
    <span class="text">{entryLabel(e)}</span>
    {#if e.slug === head}<span class="picker-tag now">current release</span>
    {:else if e.beta}<span class="picker-tag">beta</span>{/if}
    {#if !e.changed && e.slug !== current}<span class="picker-tag">same content</span>{/if}
  </span>
{/snippet}

<Picker {label} items={timeline} selected={active} key={(e) => e.slug} {option} href={(e) => href(e.slug)} />
