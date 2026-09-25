<script lang="ts">
  import type { Variant } from "$lib/decode/bbfw";

  let { variants = [], configs = [] }: { variants?: Variant[]; configs?: string[] } = $props();

  // One chip per platform; the sku/hw rev rows it covers go in the title.
  const platforms = $derived(
    [...new Set(variants.map((v) => v.platform))].map((platform) => ({ platform, vs: variants.filter((v) => v.platform === platform) })),
  );
</script>

{#each platforms as p (p.platform)}
  <span class="chip" title="platform/sku/hw rev: {p.vs.map((v) => `${v.platform}/${v.sku}/${v.hwRev}`).join(', ')}">
    P{p.platform}{p.vs.length > 1 ? ` ×${p.vs.length}` : ""}
  </span>
{/each}
{#each configs as c (c)}<span class="chip mono">{c}</span>{/each}
{#if !platforms.length && !configs.length}<span class="dimtext">all</span>{/if}
