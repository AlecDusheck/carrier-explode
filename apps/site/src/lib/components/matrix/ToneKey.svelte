<script lang="ts">
  import { TONE_WORDS, type Tone } from "./score.ts";

  /** The badges' states; under a tree, as one muted line. */
  let { tones, line = false }: { tones: readonly Tone[]; line?: boolean } = $props();
</script>

{#snippet keys()}
  {#each tones as t (t)}<span class="key"><i class="logo tone-{t}"></i>{TONE_WORDS[t]}</span>{/each}
{/snippet}

{#if line}
  <div class="line dimtext">{@render keys()}</div>
{:else}
  {@render keys()}
{/if}

<style>
  .key {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: normal;
    line-height: 13px;
    white-space: nowrap;
  }
  .key i {
    --logo: 10px;
    background: var(--bg);
  }
  .tone-blank {
    box-shadow: none;
    outline: 1px dashed var(--shadow);
    outline-offset: -1px;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 8px;
    margin-top: 6px;
    padding-top: 4px;
    border-top: 1px solid var(--shadow);
  }
</style>
