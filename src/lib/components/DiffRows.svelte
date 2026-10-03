<script lang="ts">
  import type { DiffRow } from "#lib/decode/index.ts";
  import { DIFF_CHIP, shortValue } from "#lib/format.ts";

  let { rows, head = "Key path", left = "Before", right = "After", lines = false, anchor }: {
    rows: DiffRow[];
    /** Gives each row an id under this prefix, so a single change can be linked to. */
    anchor?: string;
    /** First column's title. */
    head?: string;
    left?: string;
    right?: string;
    /** The values are line arrays: "[7]" is line 8. */
    lines?: boolean;
  } = $props();

  const MAX = 300;
  const at = (path: string) => (lines ? path.replace(/^\[(\d+)\]$/, (_, n) => `line ${Number(n) + 1}`) : path) || "(whole)";
  // Digests arrive as raw byte strings; printing them is noise, that they differ is the fact.
  const binary = (v: unknown): v is string => typeof v === "string" && /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/.test(v);
  const full = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));
</script>

{#snippet value(v: unknown, present: boolean)}
  {#if !present}
    <span class="dimtext">absent</span>
  {:else if binary(v)}
    <span class="dimtext">{v.length} bytes of binary</span>
  {:else}
    {@const s = shortValue(v, MAX)}
    {#if s.length > MAX}
      <details class="long">
        <summary>{s}</summary>
        <pre class="code">{full(v)}</pre>
      </details>
    {:else}
      {s}
    {/if}
  {/if}
{/snippet}

<div class="hscroll">
  <table class="grid">
    <thead><tr><th>{head}</th><th>{left}</th><th>{right}</th></tr></thead>
    <tbody>
      {#each rows as r, i (i)}
        {@const id = anchor && `${anchor}--${r.path.replace(/[^\w.-]/g, "_")}`}
        <tr {id}>
          <td class="mono wrap at">
            <span class="chip {DIFF_CHIP[r.kind]}" title={r.kind}>{r.kind[0]}</span>{#if id}<a href="#{id}" class="row-link">{at(r.path)}</a>{:else}{at(r.path)}{/if}
          </td>
          <td class="mono wrap">{@render value(r.a, r.kind !== "added")}</td>
          <td class="mono wrap">{@render value(r.b, r.kind !== "removed")}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  td { min-width: 60px; }
  details.long > summary { cursor: pointer; }
  details.long[open] > summary { color: var(--text-dim); }
  .row-link { color: inherit; text-decoration: none; }
  .row-link:hover { text-decoration: underline; }
  tr:target { background: var(--sel-row); }
</style>
