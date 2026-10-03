<script lang="ts">
  import type { Snippet } from "svelte";
  import type { FeatureState } from "#lib/features.ts";
  import { carrierName, countryName, flag } from "#lib/names.ts";
  import CarrierLogo from "#lib/components/CarrierLogo.svelte";
  import FeatureStatus from "./FeatureStatus.svelte";

  type Row = { name: string; cc?: string; state?: FeatureState | "unknown" };

  let {
    rows,
    home,
    href,
    column,
    filters,
  }: {
    rows: Row[];
    /** The visitor's country code: its carriers are shown first, and alone until asked. */
    home: string | null;
    href: (name: string) => string;
    /** Heading of the status column; none, no column. */
    column?: string;
    filters?: Snippet;
  } = $props();

  let filter = $state("");
  let everywhere = $state(false);

  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const named = $derived(
    rows
      .map((r) => ({ ...r, brand: carrierName(r.name).brand, country: countryName(r.cc) }))
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
  const twins = $derived(new Set(shown.filter((r, i) => shown.findIndex((o) => o.brand === r.brand && o.cc === r.cc) !== i).map((r) => r.brand)));
</script>

<div class="filters">
  <input class="grow" type="search" name="carrier" placeholder="Find your carrier or country" aria-label="find your carrier or country" bind:value={filter} />
  {@render filters?.()}
</div>
<table class="grid">
  {#if column}<thead><tr><th>Carrier</th><th>{column}</th></tr></thead>{/if}
  <tbody>
    {#each shown as r, i (r.name)}
      {#if i === 0 || shown[i - 1].country !== r.country}
        <tr class="group"><td colspan={column ? 2 : 1}>{#if flag(r.cc)}<span class="flag" aria-hidden="true">{flag(r.cc)}</span>{/if} {r.country ?? "Other"}</td></tr>
      {/if}
      <tr>
        <td>
          <CarrierLogo name={r.name} />
          <a href={href(r.name)}>{r.brand}</a>
          {#if twins.has(r.brand)}<span class="dimtext">{r.name.replace(/_/g, " ")}</span>{/if}
        </td>
        {#if column && r.state}<td><FeatureStatus state={r.state} /></td>{/if}
      </tr>
    {:else}
      <tr><td colspan={column ? 2 : 1} class="dimtext">No carrier matches.</td></tr>
    {/each}
  </tbody>
</table>
{#if !filter && !everywhere && local.length && local.length < named.length}
  <p><button type="button" onclick={() => (everywhere = true)}>Show every country ({named.length - local.length} more carriers)</button></p>
{/if}
