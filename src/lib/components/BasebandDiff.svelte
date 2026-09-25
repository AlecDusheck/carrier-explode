<script lang="ts">
  import type { DiffKind } from "$lib/decode/compare";
  import type { BasebandDiffPart } from "$lib/server/data";
  import { shortValue } from "$lib/format";

  let { parts }: { parts: BasebandDiffPart[] } = $props();

  // Text files are diffed as line arrays: "[7]" is line 8.
  const at = (path: string) => path.replace(/^\[(\d+)\]$/, (_, n) => `line ${Number(n) + 1}`) || "·";
  const CHIP: Record<DiffKind, string> = { added: "good", removed: "bad", changed: "warn", same: "" };
  let query = $state("");
  // Digests arrive as raw byte strings; printing them is noise, that they differ is the fact.
  const binary = (v: unknown) => typeof v === "string" && /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/.test(v);

  const q = $derived(query.trim().toLowerCase());
  const sections = $derived.by(() => {
    const hit = parts.filter((p) => !q || p.path.toLowerCase().includes(q) || p.section.toLowerCase().includes(q));
    return [...new Set(hit.map((p) => p.section))].map((s) => [s, hit.filter((p) => p.section === s)] as const);
  });
</script>

{#snippet value(v: unknown)}
  {#if v === undefined}<span class="dimtext">absent</span>
  {:else if binary(v)}<span class="dimtext">{(v as string).length} bytes of binary</span>
  {:else}{shortValue(v, 240)}{/if}
{/snippet}

{#if parts.length}
  <div class="rowflex" style="margin-bottom:6px">
    <input class="grow" type="search" name="diff-filter" placeholder="filter" aria-label="filter differences" bind:value={query} />
  </div>
  {#each sections as [section, ps] (section)}
    <h4>{section} <span class="dimtext">({ps.length})</span></h4>
    {#each ps as p (p.path)}
      <details class="part" open={ps.length <= 4 && p.rows.length > 0}>
        <summary>
          <span class="chip {CHIP[p.kind]}">{p.kind}</span>
          <span class="mono wrap">{p.path}</span>
          {#if p.rows.length}
            {@const n = p.counts.changed + p.counts.added + p.counts.removed}
            <span class="dimtext">{n} {n === 1 ? "row" : "rows"}</span>
          {/if}
        </summary>
        {#if p.rows.length}
          <div class="hscroll">
            <table class="grid">
              <thead><tr><th>At</th><th>Before</th><th>After</th></tr></thead>
              <tbody>
                {#each p.rows as r, i (i)}
                  <tr>
                    <td class="mono"><span class="chip {CHIP[r.kind]}">{r.kind[0]}</span>{at(r.path)}</td>
                    <td class="mono wrap">{@render value(r.a)}</td>
                    <td class="mono wrap">{@render value(r.b)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if p.truncated}<p class="dimtext" style="margin:2px 0">More rows than shown.</p>{/if}
        {/if}
      </details>
    {/each}
  {:else}
    <p class="dimtext">Nothing matches.</p>
  {/each}
{:else}
  <p class="dimtext" style="margin:0">The two packages summarise identically.</p>
{/if}

<style>
  h4 { margin: 8px 0 2px; }
  .part { margin: 2px 0; }
  .part > summary { cursor: pointer; padding: 3px 0; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
  .part td { min-width: 60px; }
  .part td:first-child { white-space: nowrap; }
</style>
