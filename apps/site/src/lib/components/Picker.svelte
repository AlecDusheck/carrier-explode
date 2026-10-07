<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { listKeys } from "#lib/keys.ts";
  import { fold } from "#lib/names.ts";
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
  }

  let { label, items, selected, key, option, href, section, search }: Props = $props();

  /** A found list shows this many; the box narrows the rest. */
  const SHOWN = 100;
  let query = $state("");
  const found = $derived.by(() => {
    const q = fold(query);
    return search && q ? items.filter((item) => fold(search(item)).includes(q)) : items;
  });
  const shown = $derived(search ? found.slice(0, SHOWN) : found);

  const id = $props.id();

  const isSelected = (item: T) => !!selected && key(item) === key(selected);
  // The list closes on a pick; the button carries on showing that the choice is loading.
  const loading = $derived(items.some((item) => isNavigatingTo(href(item))));

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

<div class="picker">
  {#if label}<span class="lbl" id="{id}-label">{label}</span>{/if}
  <button class="btn picker-btn" popovertarget="{id}-list" aria-labelledby={label ? `${id}-label` : undefined} aria-busy={loading || undefined} style:anchor-name="--{id}">
    {#if selected}{@render option(selected)}{:else}<span class="dimtext">Choose</span>{/if}
    {#if loading}<span class="caret busy-spin" aria-hidden="true"></span>{:else}<span class="caret" aria-hidden="true">▾</span>{/if}
  </button>
  <div popover id="{id}-list" class="picker-list" {ontoggle} style:position-anchor="--{id}" {@attach listKeys("input, a")}>
    {#if search}
      <!-- svelte-ignore a11y_autofocus -->
      <input class="picker-find" type="search" placeholder="Find" aria-label="Find" bind:value={query} autofocus />
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
