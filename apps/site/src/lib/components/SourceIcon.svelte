<script lang="ts">
  import { asset } from "$app/paths";
  import { flag, fold } from "#lib/names.ts";
  import type { Picture } from "#lib/types.ts";

  let { picture }: { picture: Picture } = $props();

  const initials = (brand: string): string => brand.split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join("").toUpperCase();
  const hue = (brand: string): number => [...fold(brand)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
</script>

{#if picture.kind === "flag"}
  {#if flag(picture.cc)}<span class="flag" aria-hidden="true">{flag(picture.cc)}</span>{/if}
{:else if picture.kind === "logo"}
  <img class="logo" src={asset(`carriers/${picture.slug}.svg`)} alt="" width="20" height="20" loading="lazy" decoding="async" />
{:else}
  <span class="logo initials" style:--hue={hue(picture.brand)} aria-hidden="true">{initials(picture.brand)}</span>
{/if}
