<script lang="ts">
  import type { PublicEntry } from "#lib/types.ts";
  import { entryLabel } from "#lib/format.ts";
  import IosIcon from "./ios/IosIcon.svelte";
  import Picker from "./Picker.svelte";

  let { label, timeline, current, head, href }: {
    label?: string;
    timeline: PublicEntry[];
    current: string;
    /** The version phones on a release run now. */
    head: string;
    href: (slug: string) => string;
  } = $props();

  const active = $derived(timeline.find((e) => e.slug === current));
</script>

{#snippet option(e: PublicEntry)}
  <span class="picker-opt">
    <IosIcon version={e.ios[0]} />
    <span class="text">{entryLabel(e)}</span>
    {#if e.slug === head}<span class="picker-tag now">current release</span>
    {:else if e.beta}<span class="picker-tag">beta</span>{/if}
    {#if !e.changed && e.slug !== current}<span class="picker-tag">same content</span>{/if}
  </span>
{/snippet}

<Picker {label} items={timeline} selected={active} key={(e) => e.slug} {option} href={(e) => href(e.slug)} />
