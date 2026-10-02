<script lang="ts">
  import { page } from "$app/state";
  import { link } from "#lib/format.ts";
  import { CARRIERS, TOPICS } from "#lib/wiki.ts";

  let { children } = $props();

  // By route rather than by href: during SSR link() is relative to the page.
  const current = (slug?: string) => (page.params.slug === slug ? "page" : undefined);
  // The carrier group opens by itself on a carrier's page.
  const onCarrier = $derived(CARRIERS.some((a) => a.slug === page.params.slug));
</script>

{#snippet item(slug: string, title: string)}
  <a href={link(`/wiki/${slug}`)} aria-current={current(slug)}>{title}</a>
{/snippet}

<div class="view">
  <div class="scroll pad">
    <div class="wiki-page">
      <nav class="wiki-nav" aria-label="Wiki">
        <a href={link("/wiki")} aria-current={current(undefined)}>Main page</a>
        <h2>Articles</h2>
        {#each TOPICS as a (a.slug)}{@render item(a.slug, a.title)}{/each}
        {#if CARRIERS.length}
          <details open={onCarrier}>
            <summary>Carriers</summary>
            {#each CARRIERS as a (a.slug)}{@render item(a.slug, a.title)}{/each}
          </details>
        {/if}
      </nav>
      <article class="wiki">
        {@render children()}
      </article>
    </div>
  </div>
</div>
