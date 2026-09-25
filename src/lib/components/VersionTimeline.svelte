<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import type { PublicEntry } from "$lib/types";
  import { entryLabel } from "$lib/format";

  let { timeline, current, href }: {
    timeline: PublicEntry[];
    current: string;
    href: (slug: string) => string;
  } = $props();

  let open = $state(false);
  const active = $derived(timeline.find((e) => e.slug === current));

  const reveal: Attachment<HTMLElement> = (node) => node.scrollIntoView({ block: "nearest" });
</script>

{#snippet rows()}
  <ol class="timeline">
    {#each timeline as e (e.slug)}
      <li>
        {#if e.slug === current}
          <a href={href(e.slug)} aria-current="true" onclick={() => (open = false)} {@attach reveal}>
            <span class="what">{entryLabel(e)}</span>
          </a>
        {:else}
          <a href={href(e.slug)} onclick={() => (open = false)}>
            <span class="what">{entryLabel(e)}</span>
            {#if !e.changed}<span class="flag">same content</span>{/if}
          </a>
        {/if}
      </li>
    {/each}
  </ol>
{/snippet}

<div class="versions wide" aria-label="versions">
  <div class="scroll">{@render rows()}</div>
</div>

<details class="versions narrow" bind:open>
  <summary class="btn">{active ? entryLabel(active) : "Versions"} <span class="dimtext">({timeline.length})</span></summary>
  <div class="scroll">{@render rows()}</div>
</details>
