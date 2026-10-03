<script module lang="ts">
  // The IP guess is for the first look at each list in a page load; later visits start empty.
  // Not reactive state: it is read once per guess and written when a guess is shown.
  const guessShown: Partial<Record<string, true>> = {};
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { page, navigating } from "$app/state";
  import type { Attachment } from "svelte/attachments";
  import { getCarriers, getCountries, guessCarrier, guessCountry } from "#lib/api/catalog.remote.ts";
  import { link, placeHref } from "#lib/format.ts";
  import { menuTrigger, copyText } from "#lib/ui-state.svelte.ts";
  import { countryName, fold } from "#lib/names.ts";
  import { PLATFORM_NAMES } from "#lib/places.ts";
  import { PLATFORMS, parseSourceKey, type Platform } from "#lib/schema/types.ts";
  import type { Group } from "#lib/types.ts";
  import Pane from "#lib/components/Pane.svelte";
  import SourceIcon from "#lib/components/SourceIcon.svelte";

  let { params, children } = $props();

  /** One line of a list: a carrier or a country. */
  interface Row {
    readonly id: string;
    readonly name: string;
    readonly cc?: string | undefined;
    readonly updated?: string | undefined;
    readonly platforms: readonly Platform[];
    /** An iOS bundle name, which the logo table is keyed by. */
    readonly bundle?: string | undefined;
  }

  /** Each group's list: what it is called, its rows, and the guess that prefills its search box. */
  const LISTS = {
    carriers: {
      label: "Carriers",
      /** Sortable by date, filterable by platform, and named by logo with the country code beside. */
      dated: true,
      byPlatform: true,
      flags: false,
      rows: async (): Promise<Row[]> => (await getCarriers()).map((c) => ({
        id: c.slug, name: c.name, cc: c.iso, updated: c.updated, platforms: c.platforms,
        bundle: c.members.map(parseSourceKey).find((r) => r?.platform === "ios")?.name,
      })),
      guess: () => guessCarrier(),
    },
    countries: {
      label: "Countries",
      /** A-Z, and pictured by flag, which already says where it is. */
      dated: false,
      byPlatform: false,
      flags: true,
      rows: async (): Promise<Row[]> => (await getCountries()).map((c) => ({
        id: c.iso, name: c.name || (countryName(c.iso) ?? c.iso), cc: c.iso,
        platforms: c.countryBundles.length ? ["ios"] : [],
      })),
      guess: () => guessCountry(),
    },
  } as const satisfies Record<Group, { label: string; dated: boolean; byPlatform: boolean; flags: boolean; rows: () => Promise<Row[]>; guess: () => Promise<string | null> }>;

  const list = $derived(LISTS[params.group]);
  const matches = (r: Row, q: string): boolean => {
    const f = fold(q);
    return r.cc === q || r.id === q || (!!f && [r.name, r.id].some((n) => fold(n).includes(f)));
  };

  // Carriers come from the network the request arrived on, countries from where it arrived from.
  async function guessFor(group: Group): Promise<string> {
    if (guessShown[group]) return "";
    const guess = await LISTS[group].guess();
    if (!guess) return "";
    const rows = await LISTS[group].rows();
    return rows.some((r) => matches(r, guess.toLowerCase())) ? guess : "";
  }

  // Only a list that is the page gets a guess; beside an open page it is navigation.
  // Depends on the group alone, so moving between carriers keeps whatever was typed.
  const guess = $derived(untrack(() => params.id) ? "" : await guessFor(params.group));
  // The box starts from the guess and resets with it when the list changes; typing overrides it.
  let query = $derived(guess);
  // Says why the box is not empty, and gets out of the way on the first edit.
  const fromIp = $derived(!!guess && query === guess);
  /** Once a guess has been on screen, that list is not guessed again. */
  const spend: Attachment = () => {
    if (fromIp) guessShown[params.group] = true;
  };

  let drawerOpen = $state(false);
  // With nothing selected the list is the page. With a carrier open it is
  // navigation, and on a phone it sits in a closed drawer, so a thousand links
  // are neither rendered nor serialised into the page until something wants
  // them: a wide screen, or the drawer opened once.
  const wide = new MediaQuery("min-width: 761px", false);
  let drawerUsed = $state(false);
  const showList = $derived(!params.id || wide.current || drawerUsed);

  // Carriers can put the most recently changed first; countries stay A-Z.
  let byUpdated = $state(true);
  let platform = $state<Platform | null>(null);
  const newestFirst = (a: Row, b: Row): number => (b.updated ?? "").localeCompare(a.updated ?? "") || a.name.localeCompare(b.name);

  // The row lights up on click, before the page behind it has loaded.
  const selected = $derived(navigating.to ? navigating.to.params?.id : page.params.id);

  const reveal: Attachment<HTMLElement> = (node) => node.scrollIntoView({ block: "nearest" });

  function rowMenu(r: Row): () => { title: string; items: Array<{ label: string; run: () => void }> } {
    return () => ({ title: r.name, items: [{ label: "Copy name", run: () => copyText(r.name) }, { label: "Copy address", run: () => copyText(location.origin + placeHref({ group: params.group, id: r.id })) }] });
  }
</script>

<!-- With nothing selected, a phone shows the list as the page instead of hiding it in the drawer. -->
<div class="split" class:browsing={!params.id}>
  <div class="pane-left" class:open={drawerOpen}>
    {#if list.byPlatform}
      <div class="family" role="group" aria-label="platform">
        <button class="btn" aria-pressed={platform === null} onclick={() => (platform = null)}>Both</button>
        {#each PLATFORMS as p (p)}
          <button class="btn" aria-pressed={platform === p} onclick={() => (platform = p)}>{PLATFORM_NAMES[p]}</button>
        {/each}
      </div>
      {#if !params.id}<a class="btn landing-link" href={link("/sim")}>Find the carrier for a SIM</a>{/if}
    {/if}
    <div class="find">
      <input class="grow" type="search" name="find" placeholder="find" aria-label="find in {params.group}" bind:value={query} {@attach spend} />
      {#if fromIp}<span class="dimtext from-ip" title="Guessed from your IP address">from IP</span>{/if}
      <button class="btn drawer-btn" onclick={() => (drawerOpen = false)}>Close</button>
    </div>
    {#if showList}
      <Pane>
        {@const all = await list.rows()}
        {@const q = query.trim().toLowerCase()}
        {@const matched = all.filter((r) => (!q || matches(r, q)) && (!platform || r.platforms.includes(platform)))}
        {@const dated = list.dated && byUpdated}
        {@const shown = dated ? [...matched].sort(newestFirst) : matched}
        <div class="scroll list-box">
          <ul class="list" aria-label={params.group}>
            {#each shown as r (r.id)}
              <li>
                <a
                  href={placeHref({ group: params.group, id: r.id })}
                  title={r.id}
                  aria-current={r.id === selected ? "page" : undefined}
                  onclick={() => (drawerOpen = false)}
                  {@attach menuTrigger(rowMenu(r))}
                  {@attach r.id === selected && reveal}
                >
                  <SourceIcon name={r.name} bundle={r.bundle} country={list.flags ? r.cc : undefined} />
                  <span class="name">{r.name}</span>
                  <span class="dim">
                    {r.platforms.map((p) => PLATFORM_NAMES[p]).join(" · ")}
                    {#if !list.flags && r.cc}&nbsp; {r.cc.toUpperCase()}{/if}
                    {#if dated && r.updated}&nbsp; {r.updated}{/if}
                  </span>
                </a>
              </li>
            {:else}
              <li class="dimtext">{all.length ? "No match" : "Nothing indexed yet."}</li>
            {/each}
          </ul>
        </div>
        <div class="statusbar list-status">
          <span class="cell grow">{q || platform ? `${shown.length} of ${all.length}` : all.length}</span>
          {#if list.dated}
            <button class="cell sort" title="Sort by when the carrier last changed, or by name" onclick={() => (byUpdated = !byUpdated)}>
              {byUpdated ? "Newest" : "A–Z"}
            </button>
          {/if}
        </div>
      </Pane>
    {/if}
  </div>

  <div class="backdrop" class:open={drawerOpen} onclick={() => (drawerOpen = false)} role="presentation"></div>

  <div class="pane-right">
    <div class="toolbar drawer-bar">
      <button class="btn drawer-btn drawer-open" onclick={() => ((drawerOpen = true), (drawerUsed = true))}>{list.label}</button>
    </div>
    {@render children()}
  </div>
</div>

<style>
  .find { padding: 6px; display: flex; gap: 6px; }
  .family { display: flex; gap: 4px; padding: 6px 6px 0; }
  .family .btn { flex: 1; text-align: center; }
  .family .btn[aria-pressed="true"] { font-weight: bold; }
  /* Wide screens have the same link in the menu bar. */
  .landing-link { display: none; margin: 6px 6px 0; text-align: center; }
  @media (max-width: 760px) {
    .landing-link { display: block; }
  }
  .from-ip { align-self: center; }
  .list-box { margin: 0 6px 6px; }
  .list-status { padding: 2px 6px 6px; }
  .sort { font: inherit; cursor: pointer; }
</style>
