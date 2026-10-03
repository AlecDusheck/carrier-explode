<script lang="ts">
  import { asset } from "$app/paths";
  import { phoneImage } from "#lib/phoneimages.ts";

  /** A phone's photo when there is one, else a plain drawn outline of a phone. */
  let { name }: { name?: string } = $props();

  const slug = $derived(phoneImage(name));
</script>

{#if slug}
  <img class="phone-img" src={asset(`phones/${slug}.webp`)} alt="" width="20" height="20" loading="lazy" decoding="async" />
{:else}
  <svg class="phone-img" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <rect x="6.5" y="2" width="11" height="20" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55" />
    <rect x="10" y="3.6" width="4" height="1.2" rx="0.6" fill="currentColor" opacity="0.55" />
  </svg>
{/if}
