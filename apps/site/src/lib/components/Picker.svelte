<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { listKeys } from "#lib/keys.ts";
  import { fold } from "#lib/names.ts";
  import { navigating } from "$app/state";
  import { isNavigatingTo } from "#lib/navigating.ts";

  /**
   * The one dropdown for choosing a version, a phone or a source: each item links to the page it chooses.
   * The list is a native popover, so it closes on an outside tap or Escape and hands focus back to the button.
   */
  interface Props {
    label?: string | undefined;
    items: readonly T[];
    selected?: T | undefined;
    key: (item: T) => string;
    /** One item's picture and text, in the button and in the list alike. */
    option: Snippet<[T]>;
    href: (item: T) => string;
    /** The section an item is listed under; a heading starts each section. */
    section?: ((item: T) => string) | undefined;
    /** For a long list: the text a find box matches each item by. */
    search?: ((item: T) => string) | undefined;
    wide?: boolean | undefined;
  }

  let { label, items, selected, key, option, href, section, search, wide }: Props = $props();

  /** A found list shows this many; the box narrows the rest. */
  const SHOWN = 100;
  let query = $state("");
  const found = $derived.by(() => {
    const q = fold(query);
    return search && q ? items.filter((item) => fold(search(item)).includes(q)) : items;
  });
  const shown = $derived(search ? found.slice(0, SHOWN) : found);

  const id = $props.id();

  const isSelected = (item: T) => selected !== undefined && key(item) === key(selected);
  // The list closes on a pick; the button carries on showing that the choice is loading.
  const loading = $derived(navigating.to !== null && items.some((item) => isNavigatingTo(href(item))));

  // Opening starts a long list where you are, and the keys there too unless a find box takes them.
  function ontoggle(e: ToggleEvent & { currentTarget: HTMLElement }) {
    if (e.newState !== "open") return;
    const list = e.currentTarget;
    const chosen = list.querySelector<HTMLElement>("[aria-current='true']");
    chosen?.scrollIntoView({ block: "nearest" });
    if (!search) (chosen ?? list.querySelector("a"))?.focus({ preventScroll: true });
  }

  const close = (e: Event & { currentTarget: HTMLElement }) => e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
</script>

<div class={["picker", { wide }]}>
  {#if label}<span class="lbl" id="{id}-label">{label}</span>{/if}
  <button class="btn picker-btn" popovertarget="{id}-list" aria-labelledby={label ? `${id}-label` : undefined} aria-busy={loading || undefined} style:anchor-name="--{id}">
    {#if selected !== undefined}{@render option(selected)}{:else}<span class="dimtext">Choose</span>{/if}
    <span class={loading ? "busy-spin" : "caret"} aria-hidden="true"></span>
  </button>
  <div popover id="{id}-list" class="picker-list raised" {ontoggle} style:position-anchor="--{id}" {@attach listKeys("input, a")}>
    {#if search}
      <!-- svelte-ignore a11y_autofocus -->
      <input class="picker-find" type="search" name="find" placeholder="Find" aria-label="Find" bind:value={query} autofocus />
    {/if}
    {#each shown as item, i (key(item))}
      {@const heading = section?.(item)}
      {@const prev = i ? shown[i - 1] : undefined}
      {#if heading !== undefined && (prev === undefined || section?.(prev) !== heading)}
        <div class="picker-section" role="presentation">{heading}</div>
      {/if}
      <a aria-current={isSelected(item) || undefined} href={href(item)} onclick={close}>{@render option(item)}</a>
    {:else}
      <div class="picker-section" role="presentation">No match</div>
    {/each}
    {#if found.length > shown.length}
      <div class="picker-section" role="presentation">{found.length - shown.length} more: narrow the search</div>
    {/if}
  </div>
</div>

<style>
  .picker {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
  }
  .picker.wide,
  .picker.wide > .picker-btn {
    width: 100%;
  }
  .picker > .lbl {
    flex: none;
    white-space: nowrap;
  }
  .picker-btn {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    max-width: 100%;
    text-align: left;
  }
  .picker-btn > :is(.caret, .busy-spin) {
    margin-left: auto;
  }
  .picker-btn .caret {
    flex: none;
    width: var(--caret-w);
    height: var(--caret-h);
    background-image: var(--caret-halves);
    background-size: 50% 100%;
    background-position: left, right;
    background-repeat: no-repeat;
  }
  .picker-find {
    margin: 6px;
    width: calc(100% - 12px);
  }
  /* On a phone a chosen option's tags go under its name rather than cut it short. */
  @media (max-width: 760px) {
    .picker-btn :global(.picker-opt) {
      flex-wrap: wrap;
      row-gap: 0;
    }
  }
  .picker-list {
    margin: 0;
    padding: 2px;
    max-height: min(60vh, 420px);
    overflow: auto;
    min-width: anchor-size(width);
    max-width: min(92vw, 520px);
    background: var(--field);
    color: inherit;
    box-shadow: 3px 3px 0 var(--drop);
    position-area: bottom span-right;
    position-try-fallbacks: flip-block, flip-inline;
  }
  .picker-list > a {
    display: flex;
    width: 100%;
    padding: 4px 8px;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    text-decoration: none;
    text-align: left;
    cursor: pointer;
  }
  .picker-section {
    padding: 6px 8px 2px;
    font-size: 11px;
    font-weight: bold;
    color: var(--text-dim);
  }
  .picker-section:not(:first-child) {
    border-top: 1px solid var(--shadow);
    margin-top: 2px;
  }
  .picker-list > a:hover {
    background: var(--hover);
  }
  .picker-list > a[aria-current="true"] {
    background: var(--sel);
    color: var(--sel-text);
  }
  .picker-list > a[aria-current="true"] :global(.dimtext) {
    color: var(--on-sel-dim);
  }
  .picker-btn[aria-busy="true"] {
    cursor: progress;
  }
  /* A finger needs a 32px target; a mouse keeps the compact rows. */
  @media (pointer: coarse) {
    .picker-list > a {
      min-height: 32px;
    }
  }
  /* A dropdown under a finger: an arrow you can see and a box you can hit. */
  @media (max-width: 760px), (pointer: coarse) {
    .btn.picker-btn {
      min-height: 44px;
    }
  }
  @media (max-width: 760px) {
    .picker-list > a {
      padding: 8px;
    }
  }
</style>
