<script lang="ts">
  import type { BasebandDiffPart } from "$lib/types";
  import { DIFF_CHIP } from "$lib/format";
  import DiffRows from "./DiffRows.svelte";

  let { parts }: { parts: BasebandDiffPart[] } = $props();

  let query = $state("");

  const q = $derived(query.trim().toLowerCase());
  const sections = $derived.by(() => {
    const hit = parts.filter((p) => !q || p.path.toLowerCase().includes(q) || p.section.toLowerCase().includes(q));
    return [...new Set(hit.map((p) => p.section))].map((s) => [s, hit.filter((p) => p.section === s)] as const);
  });
</script>

{#if parts.length}
  <div class="filters">
    <input type="search" name="diff-filter" placeholder="filter" aria-label="filter differences" bind:value={query} />
  </div>
  {#each sections as [section, ps] (section)}
    <h4>{section} <span class="dimtext">({ps.length})</span></h4>
    {#each ps as p (p.path)}
      <details class="part" open={ps.length <= 4 && p.rows.length > 0}>
        <summary>
          <span class="chip {DIFF_CHIP[p.kind]}">{p.kind}</span>
          <span class="mono wrap">{p.path}</span>
          {#if p.rows.length}
            {@const n = p.counts.changed + p.counts.added + p.counts.removed}
            <span class="dimtext">{n} {n === 1 ? "row" : "rows"}</span>
          {/if}
        </summary>
        {#if p.rows.length}
          <DiffRows rows={p.rows} head="At" lines />
          {#if p.truncated}<p class="dimtext more-rows">More rows than shown.</p>{/if}
        {/if}
      </details>
    {/each}
  {:else}
    <p class="dimtext">Nothing matches.</p>
  {/each}
{:else}
  <p class="dimtext flush">The two packages summarise identically.</p>
{/if}

<style>
  h4 { margin: 8px 0 2px; }
  .part { margin: 2px 0; }
  .part > summary { cursor: pointer; padding: 3px 0; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
  .more-rows { margin: 2px 0; }
</style>
