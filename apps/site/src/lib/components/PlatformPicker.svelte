<script lang="ts" generics="P extends Platform">
  import { asset } from "$app/paths";
  import { PLATFORM_DRAWINGS, PLATFORM_NAMES } from "#lib/platforms.ts";
  import type { Platform } from "@carrier-explode/schema/types";
  import Picker from "./Picker.svelte";

  let { platforms, selected, href }: { platforms: readonly P[]; selected: P | undefined; href: (p: P) => string } = $props();
</script>

{#snippet option(p: P)}
  <span class="picker-opt"><img class="phone-img" src={asset(PLATFORM_DRAWINGS[p])} alt="" width="20" height="20" /><span class="text">{PLATFORM_NAMES[p]}</span></span>
{/snippet}

<Picker items={platforms} {selected} key={(p) => p} {option} {href} />
