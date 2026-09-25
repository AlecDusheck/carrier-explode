<script lang="ts">
  import { parseCombo, type ComboComponent, type ComboType } from "$lib/decode";
  import { comboPart } from "$lib/format";

  let { combos }: { combos: string[] } = $props();

  const TYPES: Record<ComboType, string> = { endc: "EN-DC", nr: "NR", lte: "LTE" };
  let query = $state("");
  let type = $state<ComboType | "all">("all");

  const rows = $derived(
    combos.map((s, n) => {
      const c = parseCombo(s);
      return { n, s, c, lte: c.components.filter((x) => x.rat === "lte"), nr: c.components.filter((x) => x.rat === "nr") };
    }),
  );

  // "n77" and "b66" match a band of that RAT, a bare number any band, anything else the string.
  const matches = (r: (typeof rows)[number], tok: string) => {
    const m = /^([bn])?(\d+)$/.exec(tok);
    if (!m) return r.s.toLowerCase().includes(tok);
    const band = Number(m[2]);
    return (m[1] !== "n" && r.lte.some((x) => x.band === band)) || (m[1] !== "b" && r.nr.some((x) => x.band === band));
  };
  const shown = $derived.by(() => {
    const toks = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => (type === "all" || r.c.type === type) && toks.every((t) => matches(r, t)));
  });
  const parts = (xs: ComboComponent[]) => xs.map((x) => comboPart(x)).join(" ");
</script>

<div class="filters gap-above">
  <input type="search" name="combo-filter" placeholder="n77 b66, or any text" aria-label="filter combos" bind:value={query} />
  <select name="combo-type" aria-label="combo type" bind:value={type}>
    <option value="all">All types</option>
    {#each Object.entries(TYPES) as [t, label] (t)}<option value={t}>{label}</option>{/each}
  </select>
  <span class="dimtext">{shown.length} of {rows.length}</span>
</div>
<div class="hscroll combos">
  <table class="grid">
    <thead><tr><th>Combo</th><th>Type</th><th>LTE</th><th>NR</th><th class="num">CCs</th><th></th></tr></thead>
    <tbody>
      {#each shown as r (r.n)}
        <tr>
          <td class="mono wrap">{r.s}</td>
          <td>{r.c.type ? TYPES[r.c.type] : ""}</td>
          <td class="mono">{parts(r.lte)}</td>
          <td class="mono">{parts(r.nr)}</td>
          <td class="num">{r.c.components.length}</td>
          <td>
            {#if r.c.nrdc}<span class="chip">NR-DC</span>{/if}
            {#if r.c.swul}<span class="chip">SWUL</span>{/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="6" class="dimtext">No combo matches.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .combos { max-height: 60vh; overflow-y: auto; --sticky-top: 0; }
</style>
