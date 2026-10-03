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
  import { getIndex, guessCarrier, guessCountry } from "#lib/api/bundles.remote.ts";
  import { link } from "#lib/format.ts";
  import { menuTrigger, copyText } from "#lib/ui-state.svelte.ts";
  import { carrierName, fold } from "#lib/names.ts";
  import { PLATFORM_NAMES } from "#lib/platforms.ts";
  import { PLATFORMS } from "#lib/schema/types.ts";
  import type { ListEntry } from "#lib/server/lists.ts";
  import { SOURCE_KIND, type Kind } from "#lib/types.ts";
  import Pane from "#lib/components/Pane.svelte";
  import SourceIcon from "#lib/components/SourceIcon.svelte";

  let { params, children } = $props();

  const matches = (c: ListEntry, q: string): boolean => {
    const f = fold(q);
    // The brand too: "China Mobile" finds CMCC_cn.
    return c.cc === q || (!!f && [c.name, c.display, carrierName(c.name).brand].some((n) => fold(n).includes(f)));
  };

  /** Carriers are guessed from the network the request came in on, countries from where it came from; defaults are not guessed. */
  const GUESSES = {
    carriers: () => guessCarrier(),
    countries: () => guessCountry(),
    defaults: async () => null,
  } as const satisfies Record<Kind, () => Promise<string | null>>;

  async function guessFor(kind: Kind): Promise<string> {
    if (guessShown[kind]) return "";
    const guess = await GUESSES[kind]();
    if (!guess) return "";
    const list = (await getIndex())[SOURCE_KIND[kind]];
    return list.some((c) => matches(c, guess.toLowerCase())) ? guess : "";
  }

  // Only a list that is the page gets a guess; beside an open bundle it is navigation.
  const guess = $derived(untrack(() => params.name) ? "" : await guessFor(params.kind));
  // The box starts from the guess and resets with it when the list changes; typing overrides it.
  let query = $derived(guess);
  const fromIp = $derived(!!guess && query === guess);
  /** Once a guess has been on screen, that list is not guessed again. */
  const spend: Attachment = () => {
    if (fromIp) guessShown[params.kind] = true;
  };

  let drawerOpen = $state(false);
  // With nothing selected the list is the page. With a bundle open it is navigation (in a closed
  // drawer on a phone), so its links are not rendered until something wants them.
  const wide = new MediaQuery("min-width: 761px", false);
  let drawerUsed = $state(false);
  const showList = $derived(!params.name || wide.current || drawerUsed);

  // Carrier lists can put the most recently changed first; countries stay A-Z.
  let byUpdated = $state(true);
  const sortable = $derived(params.kind !== "countries");
  const newestFirst = (a: ListEntry, b: ListEntry): number => (b.updated ?? "").localeCompare(a.updated ?? "") || a.name.localeCompare(b.name);
  const label = $derived(params.kind[0]?.toUpperCase() + params.kind.slice(1));

  // The row lights up on click, before the bundle behind it has loaded.
  const here = $derived(navigating.to?.url.pathname ?? page.url.pathname);
  const isOpen = (c: ListEntry): boolean => here === link(c.path) || here.startsWith(link(c.path) + "/");

  const reveal: Attachment<HTMLElement> = (node) => node.scrollIntoView({ block: "nearest" });

  const rowMenu = (c: ListEntry) => () => ({ title: c.name, items: [{ label: "Copy name", run: () => copyText(c.name) }] });
</script>

<!-- With nothing selected, a phone shows the list as the page instead of hiding it in the drawer. -->
<div class="split" class:browsing={!params.name}>
  <div class="pane-left" class:open={drawerOpen}>
    <div class="family">
      <a class="btn" href={link(`/${params.kind}`)} aria-current={!params.platform ? "page" : undefined}>All</a>
      {#each PLATFORMS as p (p)}
        <a class="btn" href={link(`/${params.kind}/${p}`)} aria-current={params.platform === p ? "page" : undefined}>{PLATFORM_NAMES[p]}</a>
      {/each}
    </div>
    {#if !params.name && params.kind === "carriers"}
      <a class="btn landing-link" href={link("/sim")}>Find the bundle for a SIM</a>
    {/if}
    <div class="find">
      <input class="grow" type="search" name="find" placeholder="find" aria-label="find in {params.kind}" bind:value={query} {@attach spend} />
      {#if fromIp}<span class="dimtext from-ip" title="Guessed from your IP address">from IP</span>{/if}
      <button class="btn drawer-btn" onclick={() => (drawerOpen = false)}>Close</button>
    </div>
    {#if showList}
    <Pane>
      {@const all = (await getIndex())[SOURCE_KIND[params.kind]].filter((c) => !params.platform || c.platform === params.platform)}
      {@const q = query.trim().toLowerCase()}
      {@const matched = q ? all.filter((c) => matches(c, q)) : all}
      {@const dated = sortable && byUpdated}
      {@const shown = dated ? [...matched].sort(newestFirst) : matched}
      <div class="scroll list-box">
        <ul class="list" aria-label={params.kind}>
          {#each shown as c (c.path)}
            <li>
              <a
                href={link(c.path)}
                title={c.name}
                aria-current={isOpen(c) ? "page" : undefined}
                onclick={() => (drawerOpen = false)}
                {@attach menuTrigger(rowMenu(c))}
                {@attach isOpen(c) && reveal}
              >
                <SourceIcon name={c.display} bundle={c.name} country={params.kind === "countries" ? c.cc : undefined} />
                <span class="name">{c.display}</span>
                <span class="dim">{params.platform ? "" : PLATFORM_NAMES[c.platform]}{#if params.kind !== "countries" && c.cc}&nbsp; {c.cc.toUpperCase()}{/if}{#if dated && c.updated}&nbsp; {c.updated}{/if}</span>
              </a>
            </li>
          {:else}
            <li class="dimtext">No match</li>
          {/each}
        </ul>
      </div>
      <div class="statusbar list-status">
        <span class="cell grow">{q ? `${shown.length} of ${all.length}` : all.length}</span>
        {#if sortable}
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
      <button class="btn drawer-btn drawer-open" onclick={() => ((drawerOpen = true), (drawerUsed = true))}>{label}</button>
    </div>
    {@render children()}
  </div>
</div>

<style>
  .find { padding: 6px; display: flex; gap: 6px; }
  .family { display: flex; gap: 4px; padding: 6px 6px 0; flex-wrap: wrap; }
  .family .btn { flex: 1; text-align: center; }
  /* Wide screens have the same link beside the list. */
  .landing-link { display: none; margin: 6px 6px 0; text-align: center; }
  @media (max-width: 760px) {
    .landing-link { display: block; }
  }
  .from-ip { align-self: center; }
  .list-box { margin: 0 6px 6px; }
  .list-status { padding: 2px 6px 6px; }
  .sort { font: inherit; cursor: pointer; }
</style>
