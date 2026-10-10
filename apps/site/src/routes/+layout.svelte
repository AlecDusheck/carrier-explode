<script lang="ts">
  import "#lib/ui.css";
  import { beforeNavigate } from "$app/navigation";
  import { asset } from "$app/paths";
  import { navigating, page } from "$app/state";
  import { buildsPath, isPlatform, isReleasePlatform, listPath, RELEASE_PLATFORMS, type Platform } from "@carrier-explode/schema/types";
  import { link } from "#lib/format.ts";
  import { shortcuts } from "#lib/keys.ts";
  import { isNavigatingTo } from "#lib/navigating.ts";
  import { PLATFORM_ORDER } from "#lib/platforms.ts";
  import { SITE, seo } from "#lib/seo.ts";
  import { scan } from "#lib/ui-state.svelte.ts";
  import { visitorPlatform } from "#lib/visitor.ts";
  import { busyText } from "#lib/components/Busy.svelte";
  import ContextMenu from "#lib/components/ContextMenu.svelte";
  import ScanDialog from "#lib/components/ScanDialog.svelte";

  let { children } = $props();

  // A link to the page already shown changes nothing, yet following it reruns every load and query,
  // and that refresh hangs Svelte's flush on a pane with nested awaits.
  beforeNavigate(({ type, to, cancel }) => {
    if (type === "link" && to?.url.href === page.url.href) cancel();
  });

  // The guess's platform, once the browser says: what the menu leads to from a page of no platform.
  let visitor: Platform | null = $state(null);
  $effect(() => {
    void visitorPlatform().then((p) => (visitor = p));
  });

  /** A platform's pages lead to its own lists and builds. */
  const platform = $derived(page.params.platform !== undefined && isPlatform(page.params.platform) ? page.params.platform : (visitor ?? PLATFORM_ORDER[0]));
  const menu = $derived<Array<[string, string]>>([
    [listPath(platform, "carrier"), "Carriers"],
    [listPath(platform, "country"), "Countries"],
    ["/features", "Features"],
    [buildsPath(isReleasePlatform(platform) ? platform : RELEASE_PLATFORMS[0]), "Builds"],
    ["/compare", "Compare"],
  ]);

  const here = $derived(page.url.pathname);
  const current = (href: string): boolean => here === link(href) || here.startsWith(link(href) + "/");
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

<svelte:document onkeydown={shortcuts} />

<div class="window">
  <div class="frame">
    <div class="titlebar">
      <img class="app-icon" src={asset("favicon.svg")} alt="" width="16" height="16" />
      <a class="home" href={link("/")}>carrier-explode</a>
      <span class="spacer"></span>
      <span class="sub">Explode and decode carrier data</span>
      <a class="github" href="https://github.com/AlecDusheck/carrier-explode" rel="noreferrer">GitHub</a>
      <a class="credits" href={link("/wiki")}>About</a>
    </div>

    <nav class="menubar">
      {#each menu as [href, label] (label)}
        <a href={link(href)} aria-current={current(href) ? "page" : undefined} aria-busy={isNavigatingTo(link(href)) || undefined}>{label}</a>
      {/each}
    </nav>

    <div class="body" aria-busy={!!navigating.to || undefined}>
      {#if navigating.to}<div class="loadbar" role="progressbar" aria-label={busyText({ kind: "page" })}></div>{/if}
      {@render children()}
    </div>
  </div>
</div>

<ContextMenu />
{#if scan.open}<ScanDialog />{/if}
