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
  import { getList, getListPlatforms, guessCarrier, guessCountry } from "#lib/api/sources.remote.ts";
  import { link } from "#lib/format.ts";
  import { menuTrigger, copyText, type MenuItem } from "#lib/ui-state.svelte.ts";
  import { fold, repeated } from "#lib/names.ts";
  import { PLATFORM_NAMES, PLATFORM_ORDER } from "#lib/platforms.ts";
  import { listPath, SEGMENT_KIND, shipsKind, type KindSegment } from "@carrier-explode/schema/types";
  import type { ListRow } from "#lib/server/lists.ts";
  import Pane from "#lib/components/Pane.svelte";
  import PlatformPicker from "#lib/components/PlatformPicker.svelte";
  import SourceIcon from "#lib/components/SourceIcon.svelte";

  let { params, children } = $props();

  /** What the right pane shows: a source, or a country of a platform's carriers. */
  const selected = $derived(params.name ?? params.iso);

  const matches = (c: ListRow, q: string): boolean => {
    const f = fold(q);
    // The brand too: "China Mobile" finds CMCC_cn.
    return c.cc === q || (!!f && [c.name, c.brand].some((n) => fold(n).includes(f)));
  };

  /** Carriers are guessed from the network the request came in on, countries from where it came from; defaults are not guessed. */
  const GUESSES = {
    carriers: () => guessCarrier(),
    countries: () => guessCountry(),
    defaults: async () => null,
  } as const satisfies Record<KindSegment, () => Promise<string | null>>;

  const platform = $derived(params.platform);

  const listOf = async (kind: KindSegment): Promise<readonly ListRow[]> => getList({ platform, kind: SEGMENT_KIND[kind] });

  async function guessFor(kind: KindSegment): Promise<string> {
    if (guessShown[kind]) return "";
    const guess = await GUESSES[kind]();
    if (!guess) return "";
    const list = await listOf(kind);
    return list.some((c) => matches(c, guess.toLowerCase())) ? guess : "";
  }

  // Only a list that is the page gets a guess; beside an open bundle it is navigation. Guessed after mount, so the
  // server's page reads no visitor (the edge can keep it) and hydration sees the list the server drew.
  let guess = $state("");
  $effect(() => {
    const kind = params.kind;
    guess = "";
    if (untrack(() => selected)) return;
    let current = true;
    void guessFor(kind).then((g) => {
      if (current) guess = g;
    });
    return () => {
      current = false;
    };
  });
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
  const showList = $derived(!selected || wide.current || drawerUsed);

  // Carrier lists can put the most recently changed first; countries stay A-Z.
  let byUpdated = $state(true);
  const sortable = $derived(params.kind !== "countries");
  const newestFirst = (a: ListRow, b: ListRow): number => (b.updated ?? "").localeCompare(a.updated ?? "") || a.name.localeCompare(b.name);
  const label = $derived(params.kind[0]?.toUpperCase() + params.kind.slice(1));

  // The row lights up on click, before the bundle behind it has loaded.
  const here = $derived(navigating.to?.url.pathname ?? page.url.pathname);
  const isOpen = (c: ListRow): boolean => here === link(c.path) || here.startsWith(link(c.path) + "/");

  const twinKey = (c: ListRow): string => `${c.brand} ${c.cc}`;

  const reveal: Attachment<HTMLElement> = (node) => node.scrollIntoView({ block: "nearest" });

  const rowMenu = (c: ListRow) => (): { title: string; items: MenuItem[] } => ({ title: c.name, items: [{ kind: "action", label: "Copy name", run: () => copyText(c.name) }] });
</script>

<!-- With nothing selected, a phone shows the list as the page instead of hiding it in the drawer. -->
<div class="split" class:browsing={!selected}>
  <div class="pane-left" class:open={drawerOpen}>
    <Pane quiet>
      {@const listed = new Set((await getListPlatforms()).flatMap(([, ps]) => ps))}
      {@const platforms = PLATFORM_ORDER.filter((p) => listed.has(p))}
      {#if platforms.length > 1}
        <div class="family">
          <PlatformPicker {platforms} selected={platform} href={(p) => link(listPath(p, SEGMENT_KIND[params.kind]))} />
        </div>
      {/if}
    </Pane>
    <div class="find">
      <input class="grow" type="search" name="find" placeholder="find" aria-label="find in {params.kind}" bind:value={query} {@attach spend} />
      {#if fromIp}<span class="dimtext from-ip" title="Guessed from your IP address">from IP</span>{/if}
      <button class="btn drawer-btn" onclick={() => (drawerOpen = false)}>Close</button>
    </div>
    {#if showList}
    <Pane>
      {@const all = await listOf(params.kind)}
      {@const q = query.trim().toLowerCase()}
      {@const matched = q ? all.filter((c) => matches(c, q)) : all}
      {@const dated = sortable && byUpdated}
      {@const shown = dated ? [...matched].sort(newestFirst) : matched}
      <!-- Several files of one brand in a country (att_us, att5g_us; Verizon_LTE_US, Verizon_MVNO_US) each also say their file name. -->
      {@const twins = repeated(all, twinKey)}
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
                <SourceIcon picture={c.picture} />
                <span class="name">{c.brand}{#if twins.has(twinKey(c))}<span class="dimtext file">{c.name}</span>{/if}</span>
                <span class="dim">{params.kind === "countries" ? "" : (c.cc?.toUpperCase() ?? "")}{#if dated && c.updated}&nbsp; {c.updated}{/if}</span>
              </a>
            </li>
          {:else}
            {#if !shipsKind(platform, SEGMENT_KIND[params.kind])}
              <li class="dimtext">{PLATFORM_NAMES[platform]} does not have this concept: its settings are per carrier. <a href={link(listPath(platform, "carrier"))}>Go to carriers</a>.</li>
            {:else}
              <li class="dimtext">No match</li>
            {/if}
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
  .family { padding: 6px 6px 0; }
  .family :global(.picker), .family :global(.picker-btn) { width: 100%; }
  .from-ip { align-self: center; }
  .list-box { margin: 0 6px 6px; }
  .list-status { padding: 2px 6px 6px; }
  .sort { font: inherit; cursor: pointer; }
  .file { margin-left: 0.5em; }
</style>
