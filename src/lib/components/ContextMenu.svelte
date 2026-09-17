<script lang="ts">
  import { contextMenu } from "$lib/ui-state.svelte";

  const dismiss = () => contextMenu.open && contextMenu.hide();
</script>

<svelte:window onclick={dismiss} onscrollcapture={dismiss} onkeydown={(e) => e.key === "Escape" && dismiss()} />

{#if contextMenu.open}
  <div
    class="ctxmenu"
    style:left="{contextMenu.x}px"
    style:top="{contextMenu.y}px"
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
        <button type="button" role="menuitem" disabled={item.disabled} onclick={() => item.run?.()}>{item.label}</button>
      {/if}
    {/each}
  </div>
{/if}
