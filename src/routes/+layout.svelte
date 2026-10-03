<script lang="ts">
  import "#lib/ui.css";
  import { page } from "$app/state";
  import { link } from "#lib/format.ts";
  import { SITE, seo } from "#lib/seo.ts";
  import { scan } from "#lib/ui-state.svelte.ts";
  import ContextMenu from "#lib/components/ContextMenu.svelte";
  import ScanDialog from "#lib/components/ScanDialog.svelte";

  let { children } = $props();

  const MENU: Array<[string, string]> = [
    ["/carriers", "Carriers"],
    ["/countries", "Countries"],
    ["/features", "Features"],
    ["/builds", "iOS builds"],
    ["/compare", "Compare"],
    ["/wiki", "Wiki"],
  ];

  const here = $derived(page.url.pathname);
  // A page that knows its own title (a wiki article) says so in its data.
  const meta = $derived(page.data.meta ?? seo(page.route.id, page.params));
  // One address per page: the compare tool is the only page with meaningful
  // search params, and its results are not what should be indexed.
  const canonical = $derived(page.url.origin + page.url.pathname);
</script>

<svelte:head>
  <title>{meta.title} · {SITE}</title>
  <meta name="description" content={meta.description} />
  <link rel="canonical" href={canonical} />
  <meta property="og:title" content="{meta.title} · {SITE}" />
  <meta property="og:description" content={meta.description} />
  <meta property="og:url" content={canonical} />
</svelte:head>

<div class="window">
  <div class="frame">
    <div class="titlebar">
      <span>carrier-explode</span>
      <span class="spacer"></span>
      <span class="sub">iOS carrier and country bundles</span>
      <a class="github" href="https://github.com/AlecDusheck/carrier-explode" rel="noreferrer">GitHub</a>
    </div>

    <nav class="menubar">
      {#each MENU as [href, label] (href)}
        <!-- Compared unresolved: during SSR link() is relative to the page. -->
        <a href={link(href)} aria-current={here === href || here.startsWith(href + "/") || (href === "/carriers" && (here === "/watch" || here.startsWith("/watch/"))) ? "page" : undefined}>{label}</a>
      {/each}
    </nav>

    <div class="body">{@render children()}</div>
  </div>
</div>

<ContextMenu />
{#if scan.open}<ScanDialog />{/if}

