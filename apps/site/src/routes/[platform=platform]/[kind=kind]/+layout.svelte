<script module lang="ts">
  // The guess is for the first look at each list in a page load; later visits start empty.
  // Not reactive state: it is read once per guess and written when a guess is shown.
  const guessShown: Partial<Record<string, true>> = {};
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import type { Attachment } from "svelte/attachments";
  import * as v from "valibot";
  import { getListGuess, getListPlatforms } from "#lib/api/sources.remote.ts";
  import { listFrom } from "#lib/api/schemas.ts";
  import { visitor } from "#lib/visitor.svelte.ts";
  import { link, withParams } from "#lib/format.ts";
  import { listKeys } from "#lib/keys.ts";
  import { PLATFORM_ORDER } from "#lib/platforms.ts";
  import { listPath, SEGMENT_KIND } from "@carrier-explode/schema/types";
  import PagedList from "#lib/components/PagedList.svelte";
  import Pane from "#lib/components/Pane.svelte";
  import PlatformPicker from "#lib/components/PlatformPicker.svelte";

  let { params, children } = $props();

  /** What the right pane shows: a source, a country of a platform's carriers, or the sources named only by a SIM rule. */
  const selected = $derived(params.name ?? params.iso ?? (page.route.id?.endsWith("/others.pb") ? "others.pb" : undefined));

  // Plain values, so moving between sources leaves the list's awaits alone.
  const platform = $derived(params.platform);
  const kind = $derived(params.kind);

  // Only a list that is the page gets a guess; beside an open bundle it is navigation.
  let guess = $state("");
  $effect(() => {
    // Each navigation starts the guess over, as `params` is new on every one.
    const listed = params.kind;
    const g = visitor.guess;
    guess = "";
    if (g === null || guessShown[listed] || untrack(() => selected || query || from)) return;
    let current = true;
    void (async () => {
      // A carrier that stands in for the country is no guess of the visitor's network.
      const brand = await getListGuess({ platform, kind: SEGMENT_KIND[listed], carrier: g.fromNetwork ? g.carrier : null, country: g.country });
      if (current && !query) guess = brand ?? "";
    })();
    return () => {
      current = false;
    };
  });
  // The box starts from the link's search, else the guess, and resets with the guess when the list changes; typing overrides it.
  let query = $derived(untrack(() => page.url.searchParams.get("q")) ?? guess);
  let from = $derived(v.parse(listFrom, page.url.searchParams.get("from")));
  // Only typing writes the address, so a guess never ends up in a shared link. Shallow: the list's queries follow `query`.
  const search = (): Promise<void> => {
    from = null;
    return goto(withParams(page.url, { q: query.trim() || null, from: null }), { shallow: true, replace: true });
  };
  /** Once a guess has been on screen, that list is not guessed again. */
  const spend: Attachment = () => {
    if (guess && query === guess) guessShown[kind] = true;
  };
</script>

<!-- With nothing selected, a phone shows the list as the page; with something selected, only that. -->
<div class="split" class:browsing={!selected}>
  <div class="pane-left" {@attach listKeys(".find input, .list a")}>
    <Pane quiet>
      {@const listed = new Set((await getListPlatforms()).flatMap(([, ps]) => ps))}
      {@const platforms = PLATFORM_ORDER.filter((p) => listed.has(p))}
      {#if platforms.length > 1}
        <div class="family">
          <PlatformPicker wide {platforms} selected={platform} href={(p) => link(listPath(p, SEGMENT_KIND[kind]))} />
        </div>
      {/if}
    </Pane>
    <form class="find" method="get">
      <input class="grow" type="search" name="q" placeholder="find" aria-label="find in {kind}" bind:value={query} oninput={search} {@attach spend} />
    </form>
    <Pane>
      <PagedList {platform} {kind} {query} {from} here={page.url.pathname} />
    </Pane>
  </div>

  <div class="pane-right">
    {@render children()}
  </div>
</div>

<style>
  .find { padding: 6px; display: flex; gap: 6px; }
  .family { padding: 6px 6px 0; }
</style>
