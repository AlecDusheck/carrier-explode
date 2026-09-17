<script lang="ts">
  import { api } from "./lib/api.ts";
  import { router, VIEWS, scan, resource } from "./lib/state.svelte.ts";
  import Browser from "./lib/Browser.svelte";
  import CbsView from "./lib/CbsView.svelte";
  import PlmnView from "./lib/PlmnView.svelte";
  import Compare from "./lib/Compare.svelte";
  import ContextMenu from "./lib/ContextMenu.svelte";
  import ScanPanel from "./lib/ScanPanel.svelte";

  let drawerOpen = $state(false);

  const manifest = resource(() => api.index());
  const index = $derived(manifest.value);
  const error = $derived(manifest.error);

  const family = $derived(
    router.view === "countries" ? "Country" : router.view === "watch" ? "Watch" : "iPhone",
  );
</script>

<svelte:window onhashchange={() => router.sync()} />

<div class="window">
  <div class="frame">
    <div class="titlebar">
      <span>carrier-explode</span>
      <span class="spacer"></span>
      <span class="sub">iOS carrier and country bundles, decoded</span>
    </div>

    <nav class="menubar">
      {#each VIEWS as [v, label] (v)}
        <button aria-current={router.view === v} onclick={() => router.go(v)}>{label}</button>
      {/each}
    </nav>

    <div class="body">
      {#if error}
        <div class="banner err" style="margin:10px">{error}</div>
      {:else if !index}
        <div class="pad dimtext">Loading the manifest.</div>
      {:else if router.view === "carriers" || router.view === "countries" || router.view === "watch"}
        {#key router.view}
          <Browser {index} {family} bind:drawerOpen />
        {/key}
      {:else if router.view === "cbs"}
        <div class="view"><CbsView /></div>
      {:else if router.view === "plmn"}
        <div class="view"><PlmnView /></div>
      {:else if router.view === "compare"}
        <div class="view"><Compare {index} /></div>
      {/if}
    </div>

    <div class="statusbar">
      <span class="cell grow">
        {#if index}
          {index.carriers.length} carriers,
          {new Set([...(index.image?.countries ?? []).map((c) => c.name), ...index.countries.map((c) => c.id)]).size} countries
          {#if index.image}&middot; iOS {index.image.version} image ({index.image.build}){/if}
        {/if}
      </span>
      <span class="cell">{router.name ?? "no selection"}</span>
      {#if index}<span class="cell" title="manifest fetched">{index.fetchedAt.slice(0, 16).replace("T", " ")}Z</span>{/if}
    </div>
  </div>
</div>

<ContextMenu />
{#if scan.open}<ScanPanel />{/if}
