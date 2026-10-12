<script lang="ts">
  import { untrack } from "svelte";
  import { page } from "$app/state";
  import type { Attachment } from "svelte/attachments";
  import { getListPage, getListSize } from "#lib/api/sources.remote.ts";
  import { LIST_PAGE, type ListPageQuery } from "#lib/api/schemas.ts";
  import { link, withParams } from "#lib/format.ts";
  import { menuTrigger, copyText, type MenuItem } from "#lib/ui-state.svelte.ts";
  import { PLATFORM_NAMES } from "#lib/platforms.ts";
  import { listPath, SEGMENT_KIND, shipsKind, type KindSegment, type Platform } from "@carrier-explode/schema/types";
  import type { ListRow } from "#lib/server/lists.ts";
  import SourceIcon from "./SourceIcon.svelte";
  import SourceName from "./SourceName.svelte";

  /** A platform's list of one kind matching `query` from its `from`th row, else around the row of `here`, the page open beside it; drawn a page at a time as it scrolls either way. */
  let { platform, kind, query, from, here }: { platform: Platform; kind: KindSegment; query: string; from: number | null; here: string } = $props();

  let byUpdated = $state(true);
  const sortable = $derived(kind !== "countries");
  const dated = $derived(sortable && byUpdated);

  // Moving between the list's rows keeps the pages drawn; a new list or search starts over, around the row open then.
  const first: ListPageQuery = $derived({
    platform,
    kind: SEGMENT_KIND[kind],
    q: query.trim(),
    sort: dated ? "newest" : "name",
    from,
    reach: untrack(() => here),
  });
  let pages = $derived([first]);
  const loaded = $derived(await Promise.all(pages.map((p) => getListPage(p))));
  const matched = $derived(loaded[0]?.matched ?? 0);
  // Pages are asked edge to edge; the one at the list's top may overlap the next.
  const drawn = $derived.by(() => {
    const byFrom = loaded.toSorted((a, b) => a.from - b.from);
    const start = byFrom[0]?.from ?? 0;
    let end = start;
    const rows = byFrom.flatMap((p) => {
      const fresh = p.rows.slice(end - p.from);
      end += fresh.length;
      return fresh;
    });
    return { start, end, rows };
  });
  const size = $derived(await getListSize({ platform, kind: SEGMENT_KIND[kind] }));

  // The rows not drawn yet hold their place, so the scrollbar is the whole list's from the first paint.
  const hold: Attachment<HTMLElement> = (box) => {
    const { start, end } = drawn;
    const fill = (): void => {
      const list = box.querySelector(".list");
      const row = list?.querySelector("li")?.getBoundingClientRect().height;
      // A hidden list (beside an open source on a phone) has no rows to measure.
      if (!list || !row) return;
      // Flag rows are shorter than logo rows; the CSS height only sizes the server's first paint.
      box.style.setProperty("--list-row", `${row}px`);
      const top = list.getBoundingClientRect().top - start * row;
      const view = box.getBoundingClientRect();
      const since = Math.max(0, Math.floor((view.top - box.clientHeight - top) / row));
      const until = Math.min(matched, Math.ceil((view.bottom + box.clientHeight - top) / row));
      const asked: ListPageQuery[] = [];
      const ask = (at: number): void => {
        if (!pages.some((p) => p.from === at)) asked.push({ ...first, from: at, reach: null });
      };
      for (let at = start; at > since; at -= LIST_PAGE) ask(Math.max(0, at - LIST_PAGE));
      for (let at = end; at < until; at += LIST_PAGE) ask(at);
      if (asked.length) pages = [...pages, ...asked];
    };
    // Also when a list hidden beside an open source is shown.
    const resized = new ResizeObserver(fill);
    resized.observe(box);
    box.addEventListener("scroll", fill, { passive: true });
    return () => {
      resized.disconnect();
      box.removeEventListener("scroll", fill);
    };
  };

  const isOpen = (c: ListRow): boolean => here === link(c.path) || here.startsWith(link(c.path) + "/");

  const reveal: Attachment<HTMLElement> = (node) => node.scrollIntoView({ block: "nearest" });
  const revealFirst: Attachment<HTMLElement> = (node) => node.scrollIntoView({ block: "start" });

  const rowMenu = (c: ListRow) => (): { title: string; items: MenuItem[] } => ({ title: c.name, items: [{ kind: "action", label: "Copy name", run: () => copyText(c.name) }] });
</script>

<div class="scroll list-box" {@attach hold}>
  <div class="held" style:--held={drawn.start}>
    {#if drawn.start > 0}
      <noscript><p class="paging"><a href={withParams(page.url, { from: String(Math.max(0, drawn.start - LIST_PAGE)) })}>Previous {LIST_PAGE}</a></p></noscript>
    {/if}
  </div>
  <ul class="list" aria-label={kind} data-sveltekit-preload-data="tap">
    {#each drawn.rows as c (c.path)}
      <li>
        <a
          href={link(c.path)}
          title={c.name}
          aria-current={isOpen(c) ? "page" : undefined}
          {@attach menuTrigger(rowMenu(c))}
          {@attach isOpen(c) ? reveal : from !== null && c === loaded[0]?.rows[0] && revealFirst}
        >
          <SourceIcon picture={c.picture} />
          <span class="ellipsis"><SourceName brand={c.brand} code={c.name} withCode={c.withCode} /></span>
          <span class="dim">{kind === "countries" ? "" : (c.cc?.toUpperCase() ?? "")}{#if dated && c.updated}&nbsp; {c.updated}{/if}</span>
        </a>
      </li>
    {/each}
    {#if matched === 0}
      {#if !shipsKind(platform, SEGMENT_KIND[kind])}
        <li class="dimtext">{PLATFORM_NAMES[platform]} does not have this concept: its settings are per carrier. <a href={link(listPath(platform, "carrier"))}>Go to carriers</a>.</li>
      {:else if first.q}
        <li class="dimtext">No match</li>
      {/if}
    {/if}
  </ul>
  <div class="held" style:--held={matched - drawn.end}>
    {#if drawn.end < matched}
      <noscript><p class="paging"><a href={withParams(page.url, { from: String(drawn.end) })}>Next {LIST_PAGE}</a></p></noscript>
    {/if}
  </div>
</div>
{#if size}
  <div class="statusbar list-status">
    <span class="cell grow">{first.q ? `${matched} of ${size}` : size}</span>
    {#if sortable}
      <button class="cell sort" title="Sort by when the carrier last changed, or by name" onclick={() => (byUpdated = !byUpdated)}>
        {byUpdated ? "Newest" : "A–Z"}
      </button>
    {/if}
  </div>
{/if}

<style>
  .list-box { margin: 0 6px 6px; --list-row: 27px; }
  /* Rows loading into a spacer replace its height, so the rows on screen stay put without anchoring on it. */
  .held { height: calc(var(--held) * var(--list-row)); overflow-anchor: none; }
  @media (scripting: none) {
    .held { height: auto; }
  }
  .paging { margin: 0; padding: 3px 8px; }
  @media (max-width: 760px) {
    .list-box { --list-row: 37px; }
  }
  .list-status { padding: 2px 6px 6px; }
  .sort { font: inherit; }
</style>
