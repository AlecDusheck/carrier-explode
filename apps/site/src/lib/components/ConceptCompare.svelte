<script lang="ts">
  import type { DiffKind, DiffRow } from "@carrier-explode/values";
  import { shortValue } from "#lib/format.ts";
  import { GROUP_NAMES, conceptById, type Apn, type ApnRow, type ConceptRow, type ConceptValue, type ProfileComparison } from "@carrier-explode/schema";
  import DiffRows from "./DiffRows.svelte";

  /** Two sources of any platforms, concept by concept and APN by APN, in the diff tables' style. */
  let { comparison, left, right }: { comparison: ProfileComparison; left: string; right: string } = $props();

  let showSame = $state(false);

  // A concept one side cannot express differs; it was not added or removed.
  const KIND = { same: "same", different: "changed", "only-a": "changed", "only-b": "changed" } as const satisfies Record<ConceptRow["status"], DiffKind>;
  /** A concept only one side can express is a difference of platforms, not of these two sources: it is listed apart. */
  const oneSided = (r: ConceptRow): boolean => r.status === "only-a" || r.status === "only-b";

  /** A concept's reading as text; absent means that side cannot express it. */
  const conceptText = (v: ConceptValue | undefined): string => {
    if (!v) return "not expressible";
    if (v.kind === "unset") return "not set";
    return v.kind === "state" ? v.state : shortValue(v.value, 120);
  };

  const conceptRow = (r: ConceptRow): DiffRow => ({
    path: conceptById(r.id)?.name ?? r.id,
    kind: KIND[r.status],
    a: conceptText(r.status === "only-b" ? undefined : r.a),
    b: conceptText(r.status === "only-a" ? undefined : r.b),
  });

  const apnText = (a: Apn): string => [a.types.join(", "), a.protocol].filter(Boolean).join(" · ");

  const apnRow = (r: ApnRow): DiffRow => {
    if (r.status === "only-a") return { path: r.apn, kind: "removed", a: apnText(r.a) };
    if (r.status === "only-b") return { path: r.apn, kind: "added", b: apnText(r.b) };
    return { path: r.apn, kind: r.differs.length ? "changed" : "same", a: apnText(r.a), b: apnText(r.b) };
  };

  const shown = (rows: readonly DiffRow[]): DiffRow[] => (showSame ? [...rows] : rows.filter((r) => r.kind !== "same"));
  const groups = $derived(comparison.groups.map((g) => ({ name: GROUP_NAMES[g.group], rows: shown(g.rows.filter((r) => !oneSided(r)).map(conceptRow)) })).filter((g) => g.rows.length));
  const unshared = $derived(comparison.groups.flatMap((g) => g.rows.filter(oneSided).map(conceptRow)));
  const apns = $derived(shown(comparison.apns.map(apnRow)));
</script>

<div class="filters">
  <label class="lbl"><input type="checkbox" bind:checked={showSame} /> Show settings that match</label>
</div>
{#each groups as g (g.name)}
  <fieldset class="hgroup">
    <legend>{g.name}</legend>
    <DiffRows rows={g.rows} head="Setting" {left} {right} />
  </fieldset>
{/each}
{#if apns.length}
  <fieldset class="hgroup">
    <legend>APNs</legend>
    <DiffRows rows={apns} head="APN" {left} {right} />
  </fieldset>
{/if}
{#if !groups.length && !apns.length}
  <p class="note"><b>No difference</b> in any setting both can express.</p>
{/if}
{#if unshared.length}
  <details class="more">
    <summary>Settings only one side can express ({unshared.length})</summary>
    <DiffRows rows={unshared} head="Setting" {left} {right} />
  </details>
{/if}
