<script lang="ts">
  import type { Snippet } from "svelte";
  import { link } from "#lib/format.ts";
  import { countryName } from "@carrier-explode/schema";
  import { flag, fold, repeated } from "#lib/names.ts";
  import type { FeatureRow } from "#lib/server/features.ts";
  import SourceIcon from "#lib/components/SourceIcon.svelte";
  import SourceName from "#lib/components/SourceName.svelte";
  import FeatureStatus from "./FeatureStatus.svelte";

  let {
    rows,
    home,
    column,
    filters,
  }: {
    rows: readonly FeatureRow[];
    /** The visitor's country code: its carriers are shown first, and alone until asked. */
    home: string | null;
    /** Heading of the status column. */
    column: string;
    filters?: Snippet;
  } = $props();

  let filter = $state("");
  let everywhere = $state(false);

  const named = $derived(
    rows
      .map((row) => ({ row, country: row.cc === undefined ? undefined : countryName(row.cc) }))
      .toSorted((a, b) =>
        Number(b.row.cc === home) - Number(a.row.cc === home) ||
        Number(!a.country) - Number(!b.country) ||
        (a.country ?? "").localeCompare(b.country ?? "", "en") ||
        a.row.brand.localeCompare(b.row.brand, "en")),
  );
  const local = $derived(named.filter((r) => r.row.cc === home));
  const shown = $derived.by(() => {
    const f = fold(filter);
    if (f) return named.filter((r) => fold(r.row.brand).includes(f) || fold(r.row.name).includes(f) || fold(r.country ?? "").includes(f));
    return everywhere || !local.length ? named : local;
  });
  // Two bundles of one brand in one country (an LTE-only and a 5G SIM) are told apart by their bundle names.
  const twins = $derived(repeated(shown, (r) => `${r.row.brand} ${r.row.cc}`));
</script>

<div class="filters">
  <input class="grow" type="search" name="carrier" placeholder="Find your carrier or country" aria-label="find your carrier or country" bind:value={filter} />
  {@render filters?.()}
</div>
<table class="grid">
  <thead><tr><th>Carrier</th><th>{column}</th></tr></thead>
  <tbody>
    {#each shown as { row: r, country }, i (r.path)}
      {#if i === 0 || shown[i - 1]?.country !== country}
        <tr class="group"><td colspan="2">{#if flag(r.cc)}<span class="flag" aria-hidden="true">{flag(r.cc)}</span>{/if} {country ?? "Other"}</td></tr>
      {/if}
      <tr>
        <td>
          <SourceIcon picture={r.picture} />
          <a href={link(r.path)}><SourceName brand={r.brand} code={r.name} withCode={twins.has(`${r.brand} ${r.cc}`)} /></a>
        </td>
        <td><FeatureStatus state={r.state} defaulted={r.defaulted} /></td>
      </tr>
    {:else}
      <tr><td colspan="2" class="dimtext">No carrier matches.</td></tr>
    {/each}
  </tbody>
</table>
{#if !filter && !everywhere && local.length && local.length < named.length}
  <p><button type="button" onclick={() => (everywhere = true)}>Show every country ({named.length - local.length} more carriers)</button></p>
{/if}
