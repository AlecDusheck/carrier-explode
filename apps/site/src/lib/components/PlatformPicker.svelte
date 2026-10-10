<script lang="ts" generics="P extends Platform">
  import { asset } from "$app/paths";
  import { PLATFORM_DRAWINGS, PLATFORM_NAMES } from "#lib/platforms.ts";
  import type { Platform } from "@carrier-explode/schema/types";
  import Picker from "./Picker.svelte";

  /** With `every`, a first item named so chooses every platform: null; undefined is not yet chosen. */
  type Props =
    | { platforms: readonly P[]; selected: P | undefined; href: (p: P) => string; every?: undefined }
    | { platforms: readonly P[]; selected: P | null | undefined; href: (p: P | null) => string; every: string };

  let props: Props = $props();
</script>

{#snippet option(p: P | null)}
  {#if p === null}
    <span class="picker-opt"><span class="text">{props.every}</span></span>
  {:else}
    <span class="picker-opt"><img class="phone-img" src={asset(PLATFORM_DRAWINGS[p])} alt="" width="20" height="20" /><span class="text">{PLATFORM_NAMES[p]}</span></span>
  {/if}
{/snippet}

{#if props.every === undefined}
  <Picker items={props.platforms} selected={props.selected} key={(p) => p} {option} href={props.href} />
{:else}
  <Picker items={[null, ...props.platforms]} selected={props.selected} key={(p) => p ?? ""} {option} href={props.href} />
{/if}
