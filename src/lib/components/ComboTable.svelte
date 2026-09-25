<script lang="ts">
  import { parseCombo, type ComboComponent } from "$lib/decode/policy";

  let { combos }: { combos: string[] } = $props();

  const TYPES = ["all", "EN-DC", "NR", "LTE"] as const;
  let query = $state("");
  let type = $state<(typeof TYPES)[number]>("all");

  const rows = $derived(
    combos.map((s, n) => {
      const c = parseCombo(s);
      const lte = c.components.filter((x) => x.rat === "lte");
      const nr = c.components.filter((x) => x.rat === "nr");
      return { n, s, c, lte, nr, type: lte.length && nr.length ? "EN-DC" : nr.length ? "NR" : "LTE" };
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
    return rows.filter((r) => (type === "all" || r.type === type) && toks.every((t) => matches(r, t)));
  });
  const cc = (xs: ComboComponent[], p: string) => xs.map((x) => `${p}${x.band}${x.dl}${x.ul ? "↑" + x.ul : ""}`).join(" ");
</script>

<div class="rowflex" style="margin:6px 0">
  <input class="grow" type="search" name="combo-filter" placeholder="n77 b66, or any text" aria-label="filter combos" bind:value={query} />
  <select name="combo-type" aria-label="combo type" bind:value={type}>
    {#each TYPES as t (t)}<option value={t}>{t === "all" ? "All types" : t}</option>{/each}
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
          <td>{r.type}</td>
          <td class="mono">{cc(r.lte, "B")}</td>
          <td class="mono">{cc(r.nr, "n")}</td>
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
