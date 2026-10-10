<script lang="ts">
  import { getSamsung } from "#lib/api/samsung.remote.ts";
  import { verArgs } from "#lib/format.ts";
  import { selectionRows, simRule } from "#lib/settings.ts";
  import type { TabProps } from "#lib/types.ts";
  import CarrierMembers from "../CarrierMembers.svelte";
  import Copies from "../Copies.svelte";
  import Rare from "../Rare.svelte";
  import SourceFeatures from "../features/SourceFeatures.svelte";
  import OverviewColumns from "../OverviewColumns.svelte";
  import SelectionTable from "../SelectionTable.svelte";

  /** Laid out as the Apple Overview: the pack, the SIMs that select it, and what is rare in it. */
  let { at }: TabProps = $props();

  const v = $derived(await getSamsung(verArgs(at)));
  const rules = $derived(v.sims.map(simRule));
</script>

<OverviewColumns>
  {#snippet side()}<SourceFeatures {at} tabOf={(key) => (key.startsWith("customer.xml:Settings.Connections.Profile") ? "apns" : "settings")} phones={[at.line]} file={null} />{/snippet}

  <fieldset class="hgroup">
    <legend>Carrier pack</legend>
    <table class="grid fit">
      <tbody>
        <tr><td class="k">omc.info</td><td class="mono">{v.omc}</td></tr>
        {#if v.line !== null && v.model !== v.line}<tr><td class="k">Built for</td><td class="mono">{v.model}: Samsung reuses packs across models</td></tr>{/if}
      </tbody>
    </table>
    <details class="more">
      <summary>Digest and source</summary>
      <table class="grid">
        <tbody><tr><td class="k">SHA-256</td><td class="mono">{v.sha}</td></tr></tbody>
      </table>
      <Copies entry={v.entry} />
    </details>
  </fieldset>

  {#if rules.length}
    <fieldset class="hgroup">
      <legend>Selected by ({selectionRows(rules).length})</legend>
      <p class="dimtext note">omc.info's carrier list: a SIM matching any of these loads the pack.</p>
      <SelectionTable {rules} />
    </fieldset>
  {/if}

  <CarrierMembers {at} />

  <Rare {at} />
</OverviewColumns>
