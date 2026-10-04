<script lang="ts">
  import { asset } from "$app/paths";
  import { carrierLogo } from "#lib/carrierlogos.ts";
  import { carrierName, flag, fold } from "#lib/names.ts";
  import type { Kind } from "#lib/types.ts";

  /**
   * The one picture for a bundle wherever it is named: a carrier's logo, else its
   * initials on a colour of its own; a country's flag when its ISO code is known,
   * else nothing.
   */
  let { kind, name, cc }: { kind: Kind; name: string; cc?: string } = $props();

  const slug = $derived(kind === "countries" ? undefined : carrierLogo(name));
  const brand = $derived(carrierName(name).brand);
  const initials = $derived(brand.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase());
  const hue = $derived([...fold(brand)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0));
</script>

{#if kind === "countries"}
  {#if flag(cc)}<span class="flag" aria-hidden="true">{flag(cc)}</span>{/if}
{:else if slug}
  <img class="logo" src={asset(`carriers/${slug}.svg`)} alt="" width="20" height="20" loading="lazy" decoding="async" />
{:else}
  <span class="logo initials" style:--hue={hue} aria-hidden="true">{initials}</span>
{/if}
