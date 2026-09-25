<script module lang="ts">
  // The guess is for the first look at a list only; never again in the same session.
  const guessSpent = new Set<string>();
</script>

<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page, navigating } from "$app/state";
  import type { Attachment } from "svelte/attachments";
  import { getIndex, guessCarrier, guessCountry } from "$lib/api/bundles.remote";
  import { bundleHref, link } from "$lib/format";
  import { menuTrigger, copyText } from "$lib/ui-state.svelte";
  import Pane from "$lib/components/Pane.svelte";

  let { params, children } = $props();

  type Row = { name: string; display: string; cc?: string };
  const matches = (c: Row, q: string) => c.name.toLowerCase().includes(q) || c.display.toLowerCase().includes(q) || c.cc === q;

  // Carriers come from the network the request arrived on, countries from where
  // it arrived from. Watch bundles have neither.
  async function firstQuery() {
    const wanted = !params.name && !guessSpent.has(params.kind) && params.kind !== "watch";
    if (browser) guessSpent.add(params.kind);
    if (!wanted) return "";
    const guess = params.kind === "countries" ? await guessCountry() : await guessCarrier();
    if (!guess) return "";
    const list = (await getIndex())[params.kind];
    // The box keeps the bundle's own spelling ("UnitedStates"); the filter lowercases.
    return list.some((c) => matches(c, guess.toLowerCase())) ? guess : "";
  }

  const first = await firstQuery();
  let guessed = $state(first);
  let query = $state(first);
  // Says why the box is not empty, and gets out of the way on the first edit.
  const fromIp = $derived(!!guessed && query === guessed);

  // This layout survives the move between two lists, so nothing re-runs on its
  // own. A carrier search means nothing in the country list: drop it and guess
  // again for the list now on screen.
  let listed = "";
  $effect(() => {
    const kind = params.kind;
    if (!listed) return void (listed = kind); // the guess above already covered this one
    if (kind === listed) return;
    listed = kind;
    query = "";
    guessed = "";
    firstQuery().then((next) => {
      if (next && listed === kind) (guessed = next), (query = next);
    });
  });
  let drawerOpen = $state(false);

  // With nothing selected the list is the page. With a bundle open it is
  // navigation — and on a phone it sits in a closed drawer — so 782 links are
  // neither rendered nor serialised into the page until something wants them.
  let wanted = $state(false);
  $effect(() => {
    const wide = window.matchMedia("(min-width: 761px)");
    const check = () => (wanted ||= drawerOpen || wide.matches);
    check();
    wide.addEventListener("change", check);
    return () => wide.removeEventListener("change", check);
  });
  const showList = $derived(!params.name || wanted);
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
    <div style="padding:6px; display:flex; gap:6px">
      <input class="grow" type="search" name="find" placeholder="find" aria-label="find in {params.kind}" bind:value={query} />
      {#if fromIp}<span class="dimtext" style="align-self:center" title="Guessed from your IP address">from IP</span>{/if}
      <button class="btn drawer-btn" onclick={() => (drawerOpen = false)}>Close</button>
    </div>
    {#if showList}
    <Pane>
      {@const all = (await getIndex())[params.kind]}
      {@const q = query.trim().toLowerCase()}
      {@const shown = q ? all.filter((c) => matches(c, q)) : all}
      <div class="scroll" style="margin:0 6px 6px">
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
                <span class="name">{c.display}</span>
                <span class="dim">{c.cc ? c.cc.toUpperCase() + " " : ""}{c.ota + ("image" in c && c.image ? 1 : 0)}</span>
              </a>
            </li>
          {:else}
            <li class="dimtext">No match</li>
          {/each}
        </ul>
      </div>
      <div class="statusbar" style="padding:2px 6px 6px">
        <span class="cell grow">{shown.length} of {all.length}</span>
      </div>
    </Pane>
    {/if}
  </div>

  <div class="backdrop" class:open={drawerOpen} onclick={() => (drawerOpen = false)} role="presentation"></div>

  <div class="pane-right">
    <div class="toolbar drawer-bar">
      <button class="btn drawer-btn drawer-open" onclick={() => (drawerOpen = true)}>{label}</button>
    </div>
    {@render children()}
  </div>
</div>
