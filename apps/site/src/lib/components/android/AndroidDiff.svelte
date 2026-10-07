<script lang="ts">
  import { diffCounts } from "#lib/format.ts";
  import type { AndroidChanges } from "#lib/server/android/settings.ts";
  import DiffRows from "../DiffRows.svelte";

  /** Two Android versions, config key by key and APN by APN, each part only where it changed; its sides Before and After unless named. */
  let { changes, left = "Before", right = "After" }: { changes: AndroidChanges; left?: string; right?: string } = $props();
</script>

{#if changes.configs.rows.length}
  <fieldset class="hgroup">
    <legend>Config keys: {diffCounts(changes.configs.counts)}</legend>
    <DiffRows rows={changes.configs.rows} head="Key" {left} {right} />
  </fieldset>
{/if}
{#if changes.apns.rows.length}
  <fieldset class="hgroup">
    <legend>APNs</legend>
    <DiffRows rows={changes.apns.rows} head="APN field" {left} {right} />
  </fieldset>
{/if}
{#if !changes.configs.rows.length && !changes.apns.rows.length}<p class="dimtext note">No change.</p>{/if}
