<script lang="ts" generics="T">
  import type { Snippet } from "svelte";

  /**
   * The one dropdown for choosing an iOS version or an iPhone: a button showing
   * the choice, opening a list where each item carries its picture. Items are
   * links when `href` is given (a choice is a page), else `onpick` is called.
   * The list is a native popover, so it closes on an outside tap or Escape.
   */
  let { label, items, selected, key, option, href, onpick }: {
    label?: string;
    items: T[];
    selected?: T;
    key: (item: T) => string;
    /** One item's picture and text, in the button and in the list alike. */
    option: Snippet<[T]>;
    href?: (item: T) => string;
    onpick?: (item: T) => void;
  } = $props();

  const id = $props.id();

  const isSelected = (item: T) => !!selected && key(item) === key(selected);

  // Opening scrolls the chosen item into view, so a long list starts where you are.
  function ontoggle(e: ToggleEvent & { currentTarget: HTMLElement }) {
    if (e.newState === "open") e.currentTarget.querySelector("[aria-selected='true']")?.scrollIntoView({ block: "nearest" });
  }

  const close = (e: Event & { currentTarget: HTMLElement }) => e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
</script>

<div class="picker">
  {#if label}<span class="lbl" id="{id}-label">{label}</span>{/if}
  <button class="btn picker-btn" popovertarget="{id}-list" aria-haspopup="listbox" aria-labelledby={label ? `${id}-label` : undefined} style:anchor-name="--{id}">
    {#if selected}{@render option(selected)}{:else}<span class="dimtext">Choose</span>{/if}
    <span class="caret" aria-hidden="true">▾</span>
  </button>
  <div popover id="{id}-list" class="picker-list" role="listbox" {ontoggle} style:position-anchor="--{id}">
    {#each items as item (key(item))}
      {#if href}
        <a role="option" aria-selected={isSelected(item)} href={href(item)} onclick={close}>{@render option(item)}</a>
      {:else}
        <button role="option" aria-selected={isSelected(item)} onclick={(e) => { close(e); onpick?.(item); }}>{@render option(item)}</button>
      {/if}
    {/each}
  </div>
</div>
