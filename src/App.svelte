<script lang="ts">
  import { api, type IndexPayload } from "./lib/api.ts";
  import { router, VIEWS, scan } from "./lib/state.svelte.ts";
  import Browser from "./lib/Browser.svelte";
  import CbsView from "./lib/CbsView.svelte";
  import PlmnView from "./lib/PlmnView.svelte";
  import Compare from "./lib/Compare.svelte";
  import About from "./lib/About.svelte";
  import ContextMenu from "./lib/ContextMenu.svelte";
  import ScanPanel from "./lib/ScanPanel.svelte";

  let index = $state<IndexPayload | null>(null);
  let error = $state<string | null>(null);
  let drawerOpen = $state(false);

  $effect(() => {
    api.index().then((i) => (index = i)).catch((e) => (error = String(e.message ?? e)));
  });

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
      {:else if router.view === "about"}
        <div class="view"><About {index} /></div>
      {/if}
    </div>

    <div class="statusbar">
      <span class="cell grow">
        {#if index}
          {index.counts.carriers} carrier bundles, {index.counts.countryBundles} country bundles,
          {index.counts.MobileDeviceCarriersByMccMnc} PLMN entries
        {/if}
      </span>
      <span class="cell">{router.name ?? "no selection"}</span>
    </div>
  </div>
</div>

<ContextMenu />
{#if scan.open}<ScanPanel />{/if}
