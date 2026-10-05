<script lang="ts">
  import type { AndroidChanges } from "#lib/server/android/settings.ts";
  import DiffRows from "../DiffRows.svelte";

  /** Two Android versions, config key by key and APN by APN; its sides Before and After unless named. */
  let { changes, left = "Before", right = "After" }: { changes: AndroidChanges; left?: string; right?: string } = $props();
</script>

<fieldset class="hgroup">
  <legend>Config keys: {changes.configs.counts.changed} changed, {changes.configs.counts.added} added, {changes.configs.counts.removed} removed</legend>
  {#if changes.configs.rows.length}<DiffRows rows={changes.configs.rows} head="Key" {left} {right} />{:else}<p class="dimtext note">No change.</p>{/if}
</fieldset>
<fieldset class="hgroup">
  <legend>APNs</legend>
  {#if changes.apns.rows.length}<DiffRows rows={changes.apns.rows} head="APN field" {left} {right} />{:else}<p class="dimtext note">No change.</p>{/if}
</fieldset>
