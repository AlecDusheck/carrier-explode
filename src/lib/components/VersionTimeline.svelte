<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import type { PublicEntry } from "#lib/types.ts";
  import { entryLabel } from "#lib/format.ts";

  let { timeline, current, head, href }: {
    timeline: PublicEntry[];
    current: string;
    /** The version phones on a release run now. */
    head: string;
    href: (slug: string) => string;
  } = $props();

  let open = $state(false);
  const active = $derived(timeline.find((e) => e.slug === current));

  const reveal: Attachment<HTMLElement> = (node) => node.scrollIntoView({ block: "nearest" });
</script>

{#snippet flags(e: PublicEntry)}
  {#if e.slug === head}<span class="flag now">current release</span>
  {:else if e.beta}<span class="flag">beta</span>{/if}
  {#if !e.changed && e.slug !== current}<span class="flag">same content</span>{/if}
{/snippet}

<!-- One list: wide screens show it as a strip, narrow ones drop it down from the button. -->
<div class="versions" class:open aria-label="versions">
  <button class="btn toggle" aria-expanded={open} onclick={() => (open = !open)}>
    {active ? entryLabel(active) : "Versions"} <span class="dimtext">({timeline.length})</span>
  </button>
  <div class="scroll">
    <ol class="timeline">
      {#each timeline as e (e.slug)}
        <li>
          {#if e.slug === current}
            <a href={href(e.slug)} aria-current="true" onclick={() => (open = false)} {@attach reveal}>
              <span class="what">{entryLabel(e)}</span>{@render flags(e)}
            </a>
          {:else}
            <a href={href(e.slug)} onclick={() => (open = false)}>
              <span class="what">{entryLabel(e)}</span>{@render flags(e)}
            </a>
          {/if}
        </li>
      {/each}
    </ol>
  </div>
</div>
