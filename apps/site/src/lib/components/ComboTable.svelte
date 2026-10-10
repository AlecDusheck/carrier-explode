<script lang="ts">
  import type { ComboType } from "@carrier-explode/decode-qualcomm";
  import { comboType, type ComboCell, type ComboRow } from "#lib/combos.ts";
  import ShowMore from "./ShowMore.svelte";

  let { rows }: { rows: readonly ComboRow[] } = $props();

  const TYPES: Record<ComboType, string> = { endc: "EN-DC", nr: "NR", lte: "LTE" };
  let query = $state("");
  let type = $state<ComboType | "all">("all");
  // A list can hold thousands of combos: drawn a page at a time.
  const PAGE = 100;
  let limit = $state(PAGE);

  const typed = $derived(rows.map((row, n) => ({ row, n, type: comboType(row) })));

  // "n77" and "b66" match a band of that RAT, a bare number any band, anything else the string.
  const matches = (r: ComboRow, tok: string) => {
    const m = /^([bn])?(\d+)$/.exec(tok);
    if (!m) return r.text.toLowerCase().includes(tok);
    const band = Number(m[2]);
    return (m[1] !== "n" && r.lte.some((x) => x.band === band)) || (m[1] !== "b" && r.nr.some((x) => x.band === band));
  };
  const shown = $derived.by(() => {
    const toks = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return typed.filter((r) => (type === "all" || r.type === type) && toks.every((t) => matches(r.row, t)));
  });
  const parts = (xs: readonly ComboCell[]) => xs.map((x) => x.text).join(" ");
</script>

<div class="filters gap-above">
  <input type="search" name="combo-filter" placeholder="n77 b66, or any text" aria-label="filter combos" bind:value={query} />
  <select name="combo-type" aria-label="combo type" bind:value={type}>
    <option value="all">All types</option>
    {#each Object.entries(TYPES) as [t, label] (t)}<option value={t}>{label}</option>{/each}
  </select>
  <span class="dimtext">{shown.length} of {typed.length}</span>
</div>
<div class="hscroll combos">
  <table class="grid">
    <thead><tr><th>Combo</th><th>Type</th><th>LTE</th><th>NR</th><th class="num">CCs</th><th></th></tr></thead>
    <tbody>
      {#each shown.slice(0, limit) as { row: r, n, type: rowType } (n)}
        <tr>
          <td class="mono">{r.text}</td>
          <td>{rowType ? TYPES[rowType] : ""}</td>
          <td class="mono">{parts(r.lte)}</td>
          <td class="mono">{parts(r.nr)}</td>
          <td class="num">{r.lte.length + r.nr.length}</td>
          <td>
            {#each r.tags as t (t)}<span class="chip">{t}</span> {/each}
          </td>
        </tr>
      {:else}
        <tr><td colspan="6" class="dimtext">No combo matches.</td></tr>
      {/each}
    </tbody>
  </table>
</div>
<ShowMore shown={Math.min(limit, shown.length)} total={shown.length} more={() => (limit += PAGE)} />

<style>
  .combos { max-height: 60vh; overflow-y: auto; --sticky-top: 0; }
</style>
