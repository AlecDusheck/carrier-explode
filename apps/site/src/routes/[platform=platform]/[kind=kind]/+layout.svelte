<script module lang="ts">
  // The guess is for the first look at each list in a page load; later visits start empty.
  // Not reactive state: it is read once per guess and written when a guess is shown.
  const guessShown: Partial<Record<string, true>> = {};
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { page } from "$app/state";
  import type { Attachment } from "svelte/attachments";
  import { getList, getListPlatforms } from "#lib/api/sources.remote.ts";
  import type { VisitorGuess } from "#lib/guess.ts";
  import { visitorGuess } from "#lib/visitor.ts";
  import { link } from "#lib/format.ts";
  import { listKeys } from "#lib/keys.ts";
  import { menuTrigger, copyText, type MenuItem } from "#lib/ui-state.svelte.ts";
  import { fold, repeated } from "#lib/names.ts";
  import { PLATFORM_NAMES, PLATFORM_ORDER } from "#lib/platforms.ts";
  import { listPath, SEGMENT_KIND, shipsKind, type KindSegment } from "@carrier-explode/schema/types";
  import type { ListRow } from "#lib/server/lists.ts";
  import Pane from "#lib/components/Pane.svelte";
  import PlatformPicker from "#lib/components/PlatformPicker.svelte";
  import SourceIcon from "#lib/components/SourceIcon.svelte";
  import SourceName from "#lib/components/SourceName.svelte";

  let { params, children } = $props();

  /** What the right pane shows: a source, a country of a platform's carriers, or the sources named only by a SIM rule. */
  const selected = $derived(params.name ?? params.iso ?? (page.route.id?.endsWith("/others.pb") ? "others.pb" : undefined));

  const matches = (c: ListRow, q: string): boolean => {
    const f = fold(q);
    // The brand too: "China Mobile" finds CMCC_cn.
    return c.cc === q || (!!f && [c.name, c.brand].some((n) => fold(n).includes(f)));
  };

  /** The row a list's search starts at: the guessed carrier when it is the network's, not a stand-in for the country; the guessed country. */
  const GUESSED = {
    carriers: (rows, g) => (g.fromNetwork ? rows.find((r) => r.brand === g.carrier) : undefined),
    countries: (rows, g) => rows.find((r) => r.cc === g.country),
    defaults: () => undefined,
  } as const satisfies Record<KindSegment, (rows: readonly ListRow[], g: VisitorGuess) => ListRow | undefined>;

  // Plain values, so moving between sources leaves the list's awaits alone.
  const platform = $derived(params.platform);
  const kind = $derived(params.kind);

  const listOf = async (of: KindSegment): Promise<readonly ListRow[]> => getList({ platform, kind: SEGMENT_KIND[of] });

  const twinKey = (c: ListRow): string => `${c.brand} ${c.cc}`;
  // Several files of one brand in a country (att_us, att5g_us; Verizon_LTE_US, Verizon_MVNO_US) each also say their file name.
  // Found with the rows: a template constant after an await is recomputed by every row that reads it.
  const rowsOf = async (of: KindSegment): Promise<{ all: readonly ListRow[]; twins: ReadonlySet<string> }> => {
    const all = await listOf(of);
    return { all, twins: repeated(all, twinKey) };
  };

  async function guessFor(of: KindSegment): Promise<string> {
    if (guessShown[of]) return "";
    const [g, list] = await Promise.all([visitorGuess(), listOf(of)]);
    return GUESSED[of](list, g)?.brand ?? "";
  }

  // Only a list that is the page gets a guess; beside an open bundle it is navigation. Guessed after mount, so the
  // server's page reads no visitor (the edge can keep it) and hydration sees the list the server drew.
  let guess = $state("");
  $effect(() => {
    // Each navigation starts the guess over, as `params` is new on every one.
    const listed = params.kind;
    guess = "";
    if (untrack(() => selected)) return;
    let current = true;
    void (async () => {
      const g = await guessFor(listed);
      if (current) guess = g;
    })();
    return () => {
      current = false;
    };
  });
  // The box starts from the guess and resets with it when the list changes; typing overrides it.
  let query = $derived(guess);
  /** Once a guess has been on screen, that list is not guessed again. */
  const spend: Attachment = () => {
    if (guess && query === guess) guessShown[kind] = true;
  };

  // With nothing selected the list is the page. With a bundle open it is navigation, which a phone reaches by the menu bar instead.
  const wide = new MediaQuery("min-width: 761px", false);
  const showList = $derived(!selected || wide.current);

  // Carrier lists can put the most recently changed first; countries stay A-Z.
  let byUpdated = $state(true);
  const sortable = $derived(kind !== "countries");
  const newestFirst = (a: ListRow, b: ListRow): number => (b.updated ?? "").localeCompare(a.updated ?? "") || a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name);

  // Only the URL: `navigating` changes in a batch of its own, and a row reading both kept a stale highlight.
  const here = $derived(page.url.pathname);
  const isOpen = (c: ListRow): boolean => here === link(c.path) || here.startsWith(link(c.path) + "/");


  const reveal: Attachment<HTMLElement> = (node) => node.scrollIntoView({ block: "nearest" });

  const rowMenu = (c: ListRow) => (): { title: string; items: MenuItem[] } => ({ title: c.name, items: [{ kind: "action", label: "Copy name", run: () => copyText(c.name) }] });
</script>

<!-- With nothing selected, a phone shows the list as the page; with something selected, only that. -->
<div class="split" class:browsing={!selected}>
  <div class="pane-left" {@attach listKeys(".find input, .list a")}>
    <Pane quiet>
      {@const listed = new Set((await getListPlatforms()).flatMap(([, ps]) => ps))}
      {@const platforms = PLATFORM_ORDER.filter((p) => listed.has(p))}
      {#if platforms.length > 1}
        <div class="family">
          <PlatformPicker {platforms} selected={platform} href={(p) => link(listPath(p, SEGMENT_KIND[kind]))} />
        </div>
      {/if}
    </Pane>
    <div class="find">
      <input class="grow" type="search" name="find" placeholder="find" aria-label="find in {kind}" bind:value={query} {@attach spend} />
    </div>
    {#if showList}
    <Pane>
      {@const { all, twins } = await rowsOf(kind)}
      {@const q = query.trim().toLowerCase()}
      {@const matched = q ? all.filter((c) => matches(c, q)) : all}
      {@const dated = sortable && byUpdated}
      {@const shown = dated ? [...matched].sort(newestFirst) : matched}
      <div class="scroll list-box">
        <ul class="list" aria-label={kind} data-sveltekit-preload-data="tap">
          {#each shown as c (c.path)}
            <li>
              <a
                href={link(c.path)}
                title={c.name}
                aria-current={isOpen(c) ? "page" : undefined}
                {@attach menuTrigger(rowMenu(c))}
                {@attach isOpen(c) && reveal}
              >
                <SourceIcon picture={c.picture} />
                <span class="name"><SourceName brand={c.brand} code={c.name} withCode={twins.has(twinKey(c))} /></span>
                <span class="dim">{kind === "countries" ? "" : (c.cc?.toUpperCase() ?? "")}{#if dated && c.updated}&nbsp; {c.updated}{/if}</span>
              </a>
            </li>
          {:else}
            {#if !shipsKind(platform, SEGMENT_KIND[kind])}
              <li class="dimtext">{PLATFORM_NAMES[platform]} does not have this concept: its settings are per carrier. <a href={link(listPath(platform, "carrier"))}>Go to carriers</a>.</li>
            {:else if q}
              <li class="dimtext">No match</li>
            {/if}
          {/each}
        </ul>
      </div>
      {#if all.length}
        <div class="statusbar list-status">
          <span class="cell grow">{q ? `${shown.length} of ${all.length}` : all.length}</span>
          {#if sortable}
            <button class="cell sort" title="Sort by when the carrier last changed, or by name" onclick={() => (byUpdated = !byUpdated)}>
              {byUpdated ? "Newest" : "A–Z"}
            </button>
          {/if}
        </div>
      {/if}
    </Pane>
    {/if}
  </div>

  <div class="pane-right">
    {@render children()}
  </div>
</div>

<style>
  .find { padding: 6px; display: flex; gap: 6px; }
  .family { padding: 6px 6px 0; }
  .family :global(.picker), .family :global(.picker-btn) { width: 100%; }
  .list-box { margin: 0 6px 6px; }
  .list-status { padding: 2px 6px 6px; }
  .sort { font: inherit; cursor: pointer; }
</style>
