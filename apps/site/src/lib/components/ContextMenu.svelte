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
</script>

<svelte:window onclick={dismiss} onscrollcapture={dismiss} {onkeydown} />

{#if contextMenu.open}
  <div
    class="ctxmenu"
    style:left="{contextMenu.x}px"
    style:top="{contextMenu.y}px"
    role="menu"
    tabindex="-1"
    oncontextmenu={(e) => e.preventDefault()}
    {@attach listKeys("button")}
    {@attach focusFirst}
  >
    {#if contextMenu.title}
      <div class="head" title={contextMenu.title}>{contextMenu.title}</div>
    {/if}
    {#each contextMenu.items as item, i (i)}
      {#if item.kind === "separator"}
        <hr />
      {:else}
        <button type="button" role="menuitem" onclick={() => choose(item)}>{item.label}</button>
      {/if}
    {/each}
  </div>
{/if}
