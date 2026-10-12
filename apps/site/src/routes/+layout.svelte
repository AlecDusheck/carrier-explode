<script lang="ts">
  import "#lib/styles/tokens.css";
  import "#lib/styles/base.css";
  import "#lib/styles/chrome.css";
  import "#lib/styles/controls.css";
  import "#lib/styles/tables.css";
  import "#lib/styles/values.css";
  import "#lib/styles/marks.css";
  import "#lib/styles/prose.css";
  import "#lib/styles/busy.css";
  import "#lib/styles/helpers.css";
  import { beforeNavigate } from "$app/navigation";
  import { asset } from "$app/paths";
  import { navigating, page } from "$app/state";
  import { buildsPath, isPlatform, isReleasePlatform, listPath, RELEASE_PLATFORMS } from "@carrier-explode/schema/types";
  import { link } from "#lib/format.ts";
  import { shortcuts } from "#lib/keys.ts";
  import { isNavigatingTo } from "#lib/navigating.ts";
  import { PLATFORM_ORDER } from "#lib/platforms.ts";
  import { SITE, seo } from "#lib/seo.ts";
  import { scan } from "#lib/ui-state.svelte.ts";
  import { visitor } from "#lib/visitor.svelte.ts";
  import { busyText } from "#lib/components/Busy.svelte";
  import ContextMenu from "#lib/components/ContextMenu.svelte";
  import ScanDialog from "#lib/components/ScanDialog.svelte";

  let { children } = $props();

  // A shallow navigation only rewrites the address: nothing loads. `navigating` lacks the `shallow` its type declares.
  let shallowNavigation = $state(false);
  const loading = $derived(navigating.to !== null && !shallowNavigation);

  // A link to the page already shown changes nothing, yet following it reruns every load and query,
  // and that refresh hangs Svelte's flush on a pane with nested awaits.
  beforeNavigate(({ type, to, cancel, shallow }) => {
    if (type === "link" && to?.url.href === page.url.href) cancel();
    shallowNavigation = shallow;
  });

  /** A platform's pages lead to its own lists and builds. */
  const platform = $derived(page.params.platform !== undefined && isPlatform(page.params.platform) ? page.params.platform : (visitor.platform ?? PLATFORM_ORDER[0]));
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

    <div class="body" aria-busy={loading || undefined}>
      {#if loading}<div class="loadbar" role="progressbar" aria-label={busyText({ kind: "page" })}></div>{/if}
      {@render children()}
    </div>
  </div>
</div>

<ContextMenu />
{#if scan.open}<ScanDialog />{/if}

<style>
  .menubar {
    display: flex;
    flex: none;
    background: var(--face);
    border-bottom: 1px solid var(--shadow);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .menubar::-webkit-scrollbar {
    display: none;
  }
  .menubar a {
    border: 1px solid transparent;
    text-decoration: none;
    padding: 3px 9px;
    color: var(--text);
    white-space: nowrap;
  }
  .menubar a:hover {
    border-color: var(--bevel-out);
  }
  .menubar a[aria-current="page"] {
    background: var(--face-hi);
    font-weight: bold;
    border-color: var(--bevel-in);
  }
  /* A finger needs a 32px target; a mouse keeps the compact rows. */
  @media (pointer: coarse) {
    .menubar a {
      min-height: 32px;
      display: inline-flex;
      align-items: center;
    }
  }
  @media (max-width: 760px) {
    .menubar {
      flex-wrap: wrap;
      overflow-x: visible;
    }
    /* Six items fit one row at 390px in Verdana, the face iOS draws Tahoma with. */
    .menubar a {
      padding: 6px 7px;
    }
  }
  .loadbar {
    position: absolute;
    inset: 0 0 auto;
    height: 3px;
    z-index: 20;
    pointer-events: none;
    background: repeating-linear-gradient(-45deg, var(--sel) 0 8px, var(--info-border) 8px 16px);
    animation:
      busy-in 0s 150ms backwards,
      busy-slide 0.6s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .loadbar {
      animation: none;
    }
  }
</style>
