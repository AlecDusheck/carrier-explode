<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { link } from "#lib/format.ts";
  import { ARTICLES, CARRIERS, TOPICS } from "#lib/wiki.ts";

  let { children } = $props();

  // By route rather than by href: during SSR link() is relative to the page.
  const current = (slug?: string) => (page.params.slug === slug ? "page" : undefined);
  // The carrier group opens by itself on a carrier's page.
  const onCarrier = $derived(CARRIERS.some((a) => a.slug === page.params.slug));
  const here = $derived(ARTICLES.find((a) => a.slug === page.params.slug)?.title ?? "Main page");

  // On a phone the list sits behind a button, and picking an article puts it away.
  let navOpen = $state(false);
  afterNavigate(() => (navOpen = false));
</script>

{#snippet item(slug: string, title: string)}
  <a href={link(`/wiki/${slug}`)} aria-current={current(slug)}>{title}</a>
{/snippet}

<div class="view">
  <div class="scroll pad">
    <div class="wiki-page">
      <button class="btn wiki-nav-toggle" aria-expanded={navOpen} aria-controls="wiki-nav" onclick={() => (navOpen = !navOpen)}>
        <span>Wiki: {here}</span><span class="chev">{navOpen ? "▲" : "▼"}</span>
      </button>
      <nav id="wiki-nav" class="wiki-nav" class:open={navOpen} aria-label="Wiki">
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
