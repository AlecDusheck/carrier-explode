<script lang="ts">
  import type { ModemConfig } from "@carrier-explode/schema/types";
  import { treeKeys } from "#lib/keys.ts";
  import { itemErrors, itemMatches, modemSections } from "#lib/modem.ts";
  import { selectionRows, simRule } from "#lib/settings.ts";
  import SelectionTable from "../SelectionTable.svelte";
  import DecodeNotes from "./DecodeNotes.svelte";
  import Facts from "./Facts.svelte";
  import ItemLine from "./ItemLine.svelte";
  import ModemCombos from "./ModemCombos.svelte";

  /** One modem configuration of any family: its header, the SIMs that select it, its items and its band combinations, each marked where it did not decode. */
  let { config }: { config: ModemConfig } = $props();

  let filter = $state("");
  // An item holding just the configuration's name (a Galaxy MCFG's banner, "ATC") says what the picker says.
  const named = (x: ModemConfig["items"][number]): boolean => x.value.kind === "text" && x.value.value === config.label;
  const shown = $derived(config.items.filter((x) => !named(x)));
  const items = $derived(shown.filter((x) => itemMatches(x, filter)));
  const errors = $derived(itemErrors(config));
</script>

<Facts facts={config.facts} />

{#if config.selection.length}
  <fieldset class="hgroup">
    <legend>Selected by ({selectionRows(config.selection.map(simRule)).length})</legend>
    <p class="dimtext note">The SIMs the modem loads this configuration for.</p>
    <SelectionTable rules={config.selection.map(simRule)} />
  </fieldset>
{/if}

<fieldset class="hgroup">
  <legend>Settings ({shown.length})<DecodeNotes errors={errors.other} /></legend>
  <div class="filters">
    <input type="search" name="modem-filter" placeholder="filter" aria-label="filter settings" bind:value={filter} />
    {#if filter.trim()}<span class="dimtext">{items.length} shown</span>{/if}
  </div>
  {#each modemSections(items) as [section, list] (section)}
    <h3 class="mono">{section} <span class="dimtext">({list.length})</span></h3>
    <div class="tree" {@attach treeKeys}>
      {#each list as item (item)}<ItemLine {item} items={config.items} {section} errors={errors.byItem.get(item.id) ?? []} />{/each}
    </div>
  {:else}
    <p class="dimtext note">No settings{filter.trim() ? " match" : config.errors.length ? " decoded" : " in this configuration"}.</p>
  {/each}
</fieldset>

{#if config.combos.length}<ModemCombos sets={config.combos} />{/if}

