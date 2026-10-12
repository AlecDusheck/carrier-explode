<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import { listKeys } from "#lib/keys.ts";
  import { contextMenu, type MenuItem } from "#lib/ui-state.svelte.ts";

  const dismiss = () => contextMenu.open && contextMenu.hide(false);
  const leave = () => contextMenu.open && contextMenu.hide(true);
  const choose = (item: Extract<MenuItem, { kind: "action" }>) => {
    leave();
    item.run();
  };
  // Tab leaves from the trigger, so it carries on to whatever follows it.
  const onkeydown = (e: KeyboardEvent) => (e.key === "Escape" || e.key === "Tab") && leave();
  const focusFirst: Attachment<HTMLElement> = (menu) => menu.querySelector("button")?.focus({ preventScroll: true });
  // show() estimates the menu's size, which taller touch rows outgrow: what overflows moves back into the viewport.
  const inView: Attachment<HTMLElement> = (menu) => {
    const { x, y } = contextMenu;
    const r = menu.getBoundingClientRect();
    contextMenu.x = Math.max(8, Math.min(x, innerWidth - 8 - r.width));
    contextMenu.y = Math.max(8, Math.min(y, innerHeight - 8 - r.height));
  };
</script>

<svelte:window onclick={dismiss} onscrollcapture={dismiss} {onkeydown} />

{#if contextMenu.open}
  <div
    class="ctxmenu raised"
    style:left="{contextMenu.x}px"
    style:top="{contextMenu.y}px"
    role="menu"
    tabindex="-1"
    oncontextmenu={(e) => e.preventDefault()}
    {@attach listKeys("button")}
    {@attach focusFirst}
    {@attach inView}
  >
    {#if contextMenu.title}
      <div class="head ellipsis" title={contextMenu.title}>{contextMenu.title}</div>
    {/if}
    {#each contextMenu.items as item, i (i)}
      {#if item.kind === "separator"}
        <hr />
      {:else}
        <button type="button" class="bare" role="menuitem" onclick={() => choose(item)}>{item.label}</button>
      {/if}
    {/each}
  </div>
{/if}
