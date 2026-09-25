<script lang="ts">
  import "$lib/ui.css";
  import { page, navigating } from "$app/state";
  import { getStats } from "$lib/api/bundles.remote";
  import { link } from "$lib/format";
  import { SITE, seo } from "$lib/seo";
  import { scan } from "$lib/ui-state.svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import ScanDialog from "$lib/components/ScanDialog.svelte";
  import Pane from "$lib/components/Pane.svelte";

  let { children } = $props();

  const MENU: Array<[string, string]> = [
    ["/carriers", "Carriers"],
    ["/countries", "Countries"],
    ["/watch", "Watch"],
    ["/cell-broadcast", "Cell Broadcast"],
    ["/plmn", "PLMN"],
    ["/baseband", "Baseband"],
    ["/compare", "Compare"],
    ["/releases", "Releases"],
  ];

  const here = $derived(page.url.pathname);
  const meta = $derived(seo(page.route.id, page.params));
  // One address per page: the compare tool is the only page with meaningful
  // search params, and its results are not what should be indexed.
  const canonical = $derived(page.url.origin + page.url.pathname);
  const busy = $derived($effect.pending() > 0 || !!navigating.to);
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
    </div>

    <nav class="menubar">
      {#each MENU as [href, label] (href)}
        {@const to = link(href)}
        <a href={to} aria-current={here === to || here.startsWith(to + "/") ? "page" : undefined}>{label}</a>
      {/each}
    </nav>

    <div class="body">{@render children()}</div>

    <div class="statusbar">
      <span class="cell grow">
        <Pane quiet>
          {@const stats = await getStats()}
          {stats.carriers} carriers, {stats.countries} countries
          {#if stats.build}&middot; iOS {stats.version} ({stats.build}){/if}
          {#if stats.beta}&middot; beta iOS {stats.beta.version} ({stats.beta.build}){/if}
        </Pane>
      </span>
      <a class="cell" href="https://github.com/AlecDusheck/carrier-explode" rel="noreferrer">GitHub</a>
      <span class="cell busy" aria-live="polite">{busy ? "Working…" : "Ready"}</span>
    </div>
  </div>
</div>

<ContextMenu />
{#if scan.open}<ScanDialog />{/if}

<style>
  .busy { width: 64px; }
</style>
