<script lang="ts">
  import type { Component } from "svelte";
  import type { Platform } from "#lib/schema/types.ts";
  import type { Version } from "#lib/types.ts";
  import { entryLabel } from "#lib/format.ts";
  import IosIcon from "./ios/IosIcon.svelte";
  import Picker from "./Picker.svelte";

  interface Props {
    label?: string | undefined;
    platform: Platform;
    timeline: readonly Version[];
    current: string;
    /** The version phones on a release run now. */
    head: string;
    href: (slug: string) => string;
  }

  let { label, platform, timeline, current, head, href }: Props = $props();

  /** The picture beside a version: iOS has one per major version; Android versions go without. */
  const ICONS = { ios: IosIcon, android: null } as const satisfies Record<Platform, Component<{ version?: string | undefined }> | null>;
  const Icon = $derived(ICONS[platform]);
  const active = $derived(timeline.find((e) => e.slug === current));
</script>

{#snippet option(e: Version)}
  <span class="picker-opt">
    {#if Icon}<Icon version={e.os[0]} />{/if}
    <span class="text">{entryLabel(e, platform)}</span>
    {#if e.slug === head}<span class="picker-tag now">current release</span>
    {:else if e.beta}<span class="picker-tag">beta</span>{/if}
    {#if !e.changed && e.slug !== current}<span class="picker-tag">same content</span>{/if}
  </span>
{/snippet}

<Picker {label} items={timeline} selected={active} key={(e) => e.slug} {option} href={(e) => href(e.slug)} />
