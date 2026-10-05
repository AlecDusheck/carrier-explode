<script lang="ts">
  import type { SelectedBy } from "#lib/server/android/settings.ts";
  import { simRule } from "#lib/settings.ts";
  import SelectionTable from "../SelectionTable.svelte";

  /** carrier_list.pb's rules for one canonical name: a SIM matching any of them loads its file. */
  let { name, selectedBy }: { name: string; selectedBy: SelectedBy } = $props();

  const rules = $derived(selectedBy.sims.map(simRule));
</script>

<p class="dimtext note">
  {rules.length} of {selectedBy.total} rules in carrier_list.pb{selectedBy.version ? ` version ${selectedBy.version}` : ""} name {name}.
  A SIM can match several carriers' rules.
</p>
{#if rules.length}<SelectionTable {rules} />{/if}
