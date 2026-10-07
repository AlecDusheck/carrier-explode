<script lang="ts">
  import type { CarrierListView } from "#lib/server/android/carrier-list.ts";
  import type { SelectionRule } from "#lib/settings.ts";
  import SelectionTable from "../SelectionTable.svelte";

  /** carrier_list.pb's rules for one canonical name; `list` is the version's own file, null for the newest build's. */
  let { rules, list }: { rules: readonly SelectionRule[]; list: Pick<CarrierListView, "version" | "total"> | null } = $props();
</script>

<p class="dimtext note">
  {#if list}{rules.length} of {list.total} rules in carrier_list.pb{list.version ? ` version ${list.version}` : ""}.{:else}From the newest build's carrier_list.pb.{/if}
</p>
{#if rules.length}<SelectionTable {rules} />{/if}
