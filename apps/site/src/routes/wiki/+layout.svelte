<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { link } from "#lib/format.ts";
  import { article, SECTION_ARTICLES, SITE_ARTICLES, type Article } from "#lib/wiki.ts";

  let { children } = $props();

  // By route rather than by href: during SSR link() is relative to the page.
  const current = (path?: string) => (page.params.path === path ? "page" : undefined);
  const here = $derived(page.params.path === undefined ? undefined : article(page.params.path));

  // On a phone the list sits behind a button, and picking an article puts it away.
  let navOpen = $state(false);
  afterNavigate(() => (navOpen = false));
</script>

{#snippet item(a: Article)}
  <a href={link(`/wiki/${a.path}`)} aria-current={current(a.path)}>{a.title}</a>
{/snippet}

<div class="view">
  <div class="scroll pad">
    <div class="wiki-page">
      <button class="btn wiki-nav-toggle" aria-expanded={navOpen} aria-controls="wiki-nav" onclick={() => (navOpen = !navOpen)}>
        <span>Wiki: {here?.title ?? "Main page"}</span><span class="chev">{navOpen ? "▲" : "▼"}</span>
      </button>
      <nav id="wiki-nav" class="wiki-nav" class:open={navOpen} aria-label="Wiki">
        <a href={link("/wiki")} aria-current={current(undefined)}>Main page</a>
        {#each SITE_ARTICLES as a (a.path)}{@render item(a)}{/each}
        {#each SECTION_ARTICLES as { section, topics, carriers } (section.id)}
          <h2>{section.title}</h2>
          {#each topics as a (a.path)}{@render item(a)}{/each}
          {#if carriers.length}
            <!-- The carrier group opens by itself on a carrier's page. -->
            <details open={carriers.some((a) => a === here)}>
              <summary>Carriers</summary>
              {#each carriers as a (a.path)}{@render item(a)}{/each}
            </details>
          {/if}
        {/each}
      </nav>
      <article class="wiki">
        {@render children()}
      </article>
    </div>
  </div>
</div>
