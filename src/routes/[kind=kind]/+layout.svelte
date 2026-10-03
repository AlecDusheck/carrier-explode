<script module lang="ts">
  // The IP guess is for the first look at each list in a page load; later visits start empty.
  // Not reactive state: it is read once per guess and written when a guess is shown.
  const guessShown: Partial<Record<string, true>> = {};
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { goto } from "$app/navigation";
  import { page, navigating } from "$app/state";
  import type { Attachment } from "svelte/attachments";
  import { getIndex, guessCarrier, guessCountry } from "#lib/api/bundles.remote.ts";
  import type { Kind } from "#lib/types.ts";
  import { bundleHref, link } from "#lib/format.ts";
  import { menuTrigger, copyText } from "#lib/ui-state.svelte.ts";
  import Pane from "#lib/components/Pane.svelte";
  import BundleIcon from "#lib/components/BundleIcon.svelte";

  let { params, children } = $props();

  type Row = { name: string; display: string; cc?: string };
  // Letters and digits only, so "AT&T" finds ATT_US and "Red Pocket" finds ATT_RedPocket_US.
  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  // A country's flag already says where it is.
  const code = (c: Row) => (params.kind === "countries" ? "" : (c.cc?.toUpperCase() ?? ""));
  const matches = (c: Row, q: string) => {
    const f = fold(q);
    return c.cc === q || (!!f && (fold(c.name).includes(f) || fold(c.display).includes(f)));
  };

  // Carriers come from the network the request arrived on, countries from where
  // it arrived from. Watch bundles have neither.
  async function guessFor(kind: Kind): Promise<string> {
    if (kind === "watch" || guessShown[kind]) return "";
    const guess = kind === "countries" ? await guessCountry() : await guessCarrier();
    if (!guess) return "";
    const list = (await getIndex())[kind];
    // The box keeps the bundle's own spelling ("UnitedStates"); the filter lowercases.
    return list.some((c) => matches(c, guess.toLowerCase())) ? guess : "";
  }

  // Only a list that is the page gets a guess; beside an open bundle it is navigation.
  // Depends on the kind alone, so moving between bundles keeps whatever was typed.
  const guess = $derived(untrack(() => params.name) ? "" : await guessFor(params.kind));
  // The box starts from the guess and resets with it when the list changes; typing overrides it.
  let query = $derived(guess);
  // Says why the box is not empty, and gets out of the way on the first edit.
  const fromIp = $derived(!!guess && query === guess);
  /** Once a guess has been on screen, that list is not guessed again. */
  const spend: Attachment = () => {
    if (fromIp) guessShown[params.kind] = true;
  };

  let drawerOpen = $state(false);
  // With nothing selected the list is the page. With a bundle open it is
  // navigation — and on a phone it sits in a closed drawer — so 782 links are
  // neither rendered nor serialised into the page until something wants them:
  // a wide screen, or the drawer opened once.
  const wide = new MediaQuery("min-width: 761px", false);
  let drawerUsed = $state(false);
  const showList = $derived(!params.name || wide.current || drawerUsed);


  // Carrier and Watch lists can put the most recently changed bundles first; countries stay A-Z.
  let byUpdated = $state(true);
  const sortable = $derived(params.kind !== "countries");
  const newestFirst = (a: { name: string; updated?: string }, b: { name: string; updated?: string }) =>
    (b.updated ?? "").localeCompare(a.updated ?? "") || a.name.localeCompare(b.name);
  const label = $derived(params.kind[0].toUpperCase() + params.kind.slice(1));

  // The row lights up on click, before the bundle behind it has loaded.
  const selected = $derived(navigating.to ? navigating.to.params?.name : page.params.name);

  const reveal: Attachment<HTMLElement> = (node) => node.scrollIntoView({ block: "nearest" });

  function rowMenu(name: string) {
    return () => ({
      title: name,
      items: [
        { label: "Copy name", run: () => copyText(name) },
        {
          label: page.params.name ? `Compare with ${page.params.name}` : "Compare",
          run: () => goto(link("/compare") + "?" + new URLSearchParams(page.params.name ? { a: page.params.name, b: name } : { a: name })),
        },
      ],
    });
  }
</script>

<!-- With nothing selected, a phone shows the list as the page instead of hiding it in the drawer. -->
<div class="split" class:browsing={!params.name}>
  <div class="pane-left" class:open={drawerOpen}>
    {#if params.kind !== "countries"}
      <!-- Watch bundles are carrier bundles for another device: one list, two families. -->
      <div class="family">
        <a class="btn" href={link("/carriers")} aria-current={params.kind === "carriers" ? "page" : undefined}>iPhone</a>
        <a class="btn" href={link("/watch")} aria-current={params.kind === "watch" ? "page" : undefined}>Apple Watch</a>
      </div>
    {/if}
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
      {@const all = (await getIndex())[params.kind]}
      {@const q = query.trim().toLowerCase()}
      {@const matched = q ? all.filter((c) => matches(c, q)) : all}
      {@const dated = sortable && byUpdated}
      {@const shown = dated ? [...matched].sort(newestFirst) : matched}
      <div class="scroll list-box">
        <ul class="list" aria-label={params.kind}>
          {#each shown as c (c.name)}
            <li>
              <a
                href={bundleHref(params.kind, c.name)}
                title={c.name}
                aria-current={c.name === selected ? "page" : undefined}
                onclick={() => (drawerOpen = false)}
                {@attach menuTrigger(rowMenu(c.name))}
                {@attach c.name === selected && reveal}
              >
                <BundleIcon kind={params.kind} name={c.name} cc={c.cc} />
                <span class="name">{c.display}</span>
                {#if code(c) || (dated && c.updated)}
                  <span class="dim">{code(c)}{#if dated && c.updated}&nbsp; {c.updated}{/if}</span>
                {/if}
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
          <button class="cell sort" title="Sort by when the bundle last changed, or by name" onclick={() => (byUpdated = !byUpdated)}>
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
  .family { display: flex; gap: 4px; padding: 6px 6px 0; }
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
