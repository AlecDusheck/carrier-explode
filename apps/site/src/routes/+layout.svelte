<script lang="ts">
  import "#lib/ui.css";
  import { asset } from "$app/paths";
  import { navigating, page } from "$app/state";
  import { buildsPath, isPlatform, isReleasePlatform, listPath, RELEASE_PLATFORMS, type Platform } from "@carrier-explode/schema/types";
  import { browserDevice } from "#lib/device.ts";
  import { link } from "#lib/format.ts";
  import { isNavigatingTo } from "#lib/navigating.ts";
  import { PLATFORM_ORDER } from "#lib/platforms.ts";
  import { SITE, seo } from "#lib/seo.ts";
  import { scan } from "#lib/ui-state.svelte.ts";
  import ContextMenu from "#lib/components/ContextMenu.svelte";
  import ScanDialog from "#lib/components/ScanDialog.svelte";

  let { children } = $props();

  // The visitor's platform, once their browser says: what the menu leads to from a page of no platform.
  let visitor: Platform | null = $state(null);
  $effect(() => {
    void browserDevice().then((d) => (visitor = d.platform));
  });

  /** A platform's pages lead to its own lists and builds. */
  const platform = $derived(page.params.platform !== undefined && isPlatform(page.params.platform) ? page.params.platform : (visitor ?? PLATFORM_ORDER[0]));
  const menu = $derived<Array<[string, string]>>([
    [listPath(platform, "carrier"), "Carriers"],
    [listPath(platform, "country"), "Countries"],
    ["/features", "Features"],
    [buildsPath(isReleasePlatform(platform) ? platform : RELEASE_PLATFORMS[0]), "Builds"],
    ["/compare", "Compare"],
    ["/wiki", "Wiki"],
  ]);

  const here = $derived(page.url.pathname);
  // A page that knows its own title (a wiki article) says so in its data.
  const meta = $derived(page.data.meta ?? seo(page.route.id, page.params, page.data.names));
  // One address per page: the compare tool is the only page with meaningful
  // search params, and its results are not what should be indexed.
  const canonical = $derived(page.url.origin + (page.data.canonical ?? page.url.pathname));
</script>

<svelte:head>
  <title>{meta.title} · {SITE}</title>
  <meta name="description" content={meta.description} />
  <link rel="canonical" href={canonical} />
  <meta property="og:title" content="{meta.title} · {SITE}" />
  <meta property="og:description" content={meta.description} />
  <meta property="og:url" content={canonical} />
  <!-- Absolute, as crawlers need, and on whichever host serves the page. -->
  <meta property="og:image" content="{page.url.origin}/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
</svelte:head>

<div class="window">
  <div class="frame">
    <div class="titlebar">
      <img class="app-icon" src={asset("favicon.svg")} alt="" width="16" height="16" />
      <span>carrier-explode</span>
      <span class="spacer"></span>
      <span class="sub">Explode and decode carrier data</span>
      <a class="github" href="https://github.com/AlecDusheck/carrier-explode" rel="noreferrer">GitHub</a>
      <a class="credits" href={link("/wiki/credits")}>About</a>
    </div>

    <nav class="menubar">
      {#each menu as [href, label] (label)}
        <!-- Compared unresolved: during SSR link() is relative to the page. -->
        <a href={link(href)} aria-current={here === href || here.startsWith(href + "/") ? "page" : undefined} aria-busy={isNavigatingTo(link(href)) || undefined}>{label}</a>
      {/each}
    </nav>

    <div class="body" aria-busy={!!navigating.to || undefined}>
      {#if navigating.to}<div class="loadbar" role="progressbar" aria-label="Loading page"></div>{/if}
      {@render children()}
    </div>
  </div>
</div>

<ContextMenu />
{#if scan.open}<ScanDialog />{/if}
