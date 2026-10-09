<script lang="ts">
  import type { PhoneChoice } from "#lib/apple/phones.ts";
  import type { Platform } from "@carrier-explode/schema/types";
  import PhoneImage from "./PhoneImage.svelte";
  import Picker from "./Picker.svelte";

  interface Props {
    platform: Platform;
    choices: readonly PhoneChoice[];
    selected?: string | undefined;
  }

  let { platform, choices, selected }: Props = $props();
</script>

{#snippet option(c: PhoneChoice)}
  <span class="picker-opt"><PhoneImage {platform} id={c.id} name={c.name} /><span class="text">{c.label}</span></span>
{/snippet}

{#if choices.length > 1}
  <Picker items={choices} selected={choices.find((c) => c.key === selected)} key={(c) => c.key} {option} href={(c) => c.href} />
{/if}
