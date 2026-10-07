<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Attachment } from "svelte/attachments";

  interface Props {
    line: Snippet;
    /** What reads under the line, folded or not. */
    under?: Snippet | undefined;
    /** What the twist folds; a line without it has no twist. */
    body?: Snippet | undefined;
    /** Whether the body starts open; it follows this until a click flips it. */
    open: boolean;
    menu?: Attachment<HTMLDivElement> | undefined;
  }

  /** One line of a value tree. */
  let { line, under, body, open: initial, menu }: Props = $props();

  let toggled = $state<boolean | null>(null);
  const open = $derived(toggled ?? initial);
</script>

<div>
  <div class="row" {@attach menu}>
    {#if body}
      <button type="button" class="twist" aria-expanded={open} aria-label={open ? "Fold" : "Unfold"} onclick={() => (toggled = !open)}>{open ? "▾" : "▸"}</button>
    {:else}
      <span class="twist" aria-hidden="true">·</span>
    {/if}
    <span>{@render line()}</span>
  </div>
  {@render under?.()}
  {#if body && open}<div class="children">{@render body()}</div>{/if}
</div>
