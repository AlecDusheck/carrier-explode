<script lang="ts">
  import type { Snippet } from "svelte";
  import { link } from "#lib/format.ts";
  import { countryName } from "@carrier-explode/schema";
  import { flag, fold, repeated } from "#lib/names.ts";
  import type { FeatureRow } from "#lib/server/features.ts";
  import SourceIcon from "#lib/components/SourceIcon.svelte";
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
      .map((r) => ({ ...r, country: r.cc === undefined ? undefined : countryName(r.cc) }))
      .sort((a, b) =>
        Number(b.cc === home) - Number(a.cc === home) ||
        Number(!a.country) - Number(!b.country) ||
        (a.country ?? "").localeCompare(b.country ?? "") ||
        a.brand.localeCompare(b.brand)),
  );
  const local = $derived(named.filter((r) => r.cc === home));
  const shown = $derived.by(() => {
    const f = fold(filter);
    if (f) return named.filter((r) => fold(r.brand).includes(f) || fold(r.name).includes(f) || fold(r.country ?? "").includes(f));
    return everywhere || !local.length ? named : local;
  });
  // Two bundles of one brand in one country (an LTE-only and a 5G SIM) are told apart by their bundle names.
  const twins = $derived(repeated(shown, (r) => `${r.brand} ${r.cc}`));
</script>

<div class="filters">
  <input class="grow" type="search" name="carrier" placeholder="Find your carrier or country" aria-label="find your carrier or country" bind:value={filter} />
  {@render filters?.()}
</div>
<table class="grid">
  <thead><tr><th>Carrier</th><th>{column}</th></tr></thead>
  <tbody>
    {#each shown as r, i (r.path)}
      {#if i === 0 || shown[i - 1]?.country !== r.country}
        <tr class="group"><td colspan="2">{#if flag(r.cc)}<span class="flag" aria-hidden="true">{flag(r.cc)}</span>{/if} {r.country ?? "Other"}</td></tr>
      {/if}
      <tr>
        <td>
          <SourceIcon picture={r.picture} />
          <a href={link(r.path)}>{r.brand}</a>
          {#if twins.has(`${r.brand} ${r.cc}`)}<span class="dimtext">{r.name.replace(/_/g, " ")}</span>{/if}
        </td>
        <td><FeatureStatus state={r.state} /></td>
      </tr>
    {:else}
      <tr><td colspan="2" class="dimtext">No carrier matches.</td></tr>
    {/each}
  </tbody>
</table>
{#if !filter && !everywhere && local.length && local.length < named.length}
  <p><button type="button" onclick={() => (everywhere = true)}>Show every country ({named.length - local.length} more carriers)</button></p>
{/if}
