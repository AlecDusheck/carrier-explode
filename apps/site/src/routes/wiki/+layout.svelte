<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { link } from "#lib/format.ts";
  import { article, SECTION_ARTICLES, SITE_ARTICLES, type Article } from "#lib/wiki.ts";

  let { children } = $props();

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

<style>
  .wiki-page {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .wiki-page > .wiki {
    flex: 1;
    min-width: 0;
  }
  button.wiki-nav-toggle {
    display: none;
    width: 100%;
    justify-content: space-between;
    align-items: center;
    text-align: left;
  }
  .wiki-nav-toggle .chev {
    color: var(--text-dim);
  }
  .wiki-nav {
    flex: none;
    width: 170px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11.5px;
    position: sticky;
    top: 0;
  }
  .wiki-nav h2 {
    font-size: 11px;
    color: var(--text-dim);
    margin: 8px 0 2px;
    font-weight: normal;
    border-bottom: 1px solid var(--shadow);
  }
  .wiki-nav a[aria-current="page"] {
    font-weight: bold;
    color: var(--text);
    text-decoration: none;
  }
  .wiki-nav details {
    margin-top: 8px;
  }
  .wiki-nav summary {
    font-size: 11px;
    color: var(--text-dim);
    border-bottom: 1px solid var(--shadow);
    margin-bottom: 2px;
  }
  .wiki-nav details > a {
    display: block;
    padding-left: 8px;
    margin: 2px 0;
  }
  @media (max-width: 760px) {
    /* One button instead of the sidebar; it opens the same list, full width. */
    .wiki-page {
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
    }
    button.wiki-nav-toggle {
      display: flex;
    }
    .wiki-nav {
      display: none;
      position: static;
      width: auto;
      font-size: 13px;
      gap: 6px;
    }
    .wiki-nav.open {
      display: flex;
    }
  }
</style>
