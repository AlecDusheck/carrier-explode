<script lang="ts">
  import { asset } from "$app/paths";
  import { carrierLogo } from "#lib/carrierlogos.ts";
  import { carrierName, fold } from "#lib/names.ts";

  let { name }: { name: string } = $props();

  const slug = $derived(carrierLogo(name));
  const brand = $derived(carrierName(name).brand);
  // Without a logo: the brand's initials on a colour of its own, the same every time.
  const initials = $derived(brand.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase());
  const hue = $derived([...fold(brand)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0));
</script>

{#if slug}
  <img class="logo" src={asset(`carriers/${slug}.webp`)} alt="" width="20" height="20" loading="lazy" decoding="async" />
{:else}
  <span class="logo initials" style:--hue={hue} aria-hidden="true">{initials}</span>
{/if}
