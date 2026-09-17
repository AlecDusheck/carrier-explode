<script lang="ts">
  import { contextMenu } from "./state.svelte.ts";

  function dismiss() {
    contextMenu.hide();
  }
</script>

<svelte:window
  onclick={() => contextMenu.open && dismiss()}
  onscroll={() => contextMenu.open && dismiss()}
  onkeydown={(e) => e.key === "Escape" && dismiss()}
/>

{#if contextMenu.open}
  <div
    class="ctxmenu"
    style="left:{contextMenu.x}px; top:{contextMenu.y}px"
    role="menu"
    tabindex="-1"
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#if contextMenu.title}
      <div class="head" title={contextMenu.title}>{contextMenu.title}</div>
    {/if}
    {#each contextMenu.items as item, i (i)}
      {#if item.separator}
        <hr />
      {:else}
        <button
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onclick={() => { item.run?.(); dismiss(); }}
        >{item.label}</button>
      {/if}
    {/each}
  </div>
{/if}
