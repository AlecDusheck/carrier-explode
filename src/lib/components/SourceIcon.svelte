<script lang="ts">
  import { asset } from "$app/paths";
  import { carrierLogo } from "#lib/carrierlogos.ts";
  import { carrierName, flag, fold } from "#lib/names.ts";

  /**
   * The one picture for a carrier or a country wherever it is named: a country's
   * flag; a carrier's logo, found by its iOS bundle name when it has one; else its
   * initials on a colour of its own.
   */
  interface Props {
    /** What the initials are taken from. */
    name: string;
    /** An iOS bundle name (ATT_US): the logo table is keyed by those. */
    bundle?: string | undefined;
    /** A country: its flag, when the code is known. */
    country?: string | undefined;
  }

  let { name, bundle, country }: Props = $props();

  const logo = $derived(bundle ? carrierLogo(bundle) : undefined);
  const brand = $derived(bundle ? carrierName(bundle).brand : name);
  const initials = $derived(brand.split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join("").toUpperCase());
  const hue = $derived([...fold(brand)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0));
</script>

{#if country !== undefined}
  {#if flag(country)}<span class="flag" aria-hidden="true">{flag(country)}</span>{/if}
{:else if logo}
  <img class="logo" src={asset(`carriers/${logo}.webp`)} alt="" width="20" height="20" loading="lazy" decoding="async" />
{:else}
  <span class="logo initials" style:--hue={hue} aria-hidden="true">{initials}</span>
{/if}
