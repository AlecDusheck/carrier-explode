<script lang="ts">
  import type { PhoneChoice } from "#lib/phones.ts";
  import type { Platform } from "#lib/schema/types.ts";
  import { PHONE_IMAGES } from "./icons";
  import Picker from "./Picker.svelte";

  interface Props {
    platform: Platform;
    choices: readonly PhoneChoice[];
    selected?: string | undefined;
  }

  let { platform, choices, selected }: Props = $props();

  const Image = $derived(PHONE_IMAGES[platform]);
</script>

{#snippet option(c: PhoneChoice)}
  <span class="picker-opt"><Image id={c.id} name={c.name} /><span class="text">{c.label}</span></span>
{/snippet}

{#if choices.length}
  <div class="filters">
    <Picker label="Phone" items={choices} selected={choices.find((c) => c.key === selected)} key={(c) => c.key} {option} href={(c) => c.href} />
  </div>
{/if}
