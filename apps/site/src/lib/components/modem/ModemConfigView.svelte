<script lang="ts">
  import type { ModemConfig } from "@carrier-explode/schema/types";
  import { itemMatches, modemSections } from "#lib/modem.ts";
  import { simRule } from "#lib/settings.ts";
  import SelectionTable from "../SelectionTable.svelte";
  import Facts from "./Facts.svelte";
  import ItemLine from "./ItemLine.svelte";
  import ModemCombos from "./ModemCombos.svelte";

  /** One modem configuration of any family: what did not decode, its header, the SIMs that select it, its items and its band combinations. */
  let { config }: { config: ModemConfig } = $props();

  let filter = $state("");
  const items = $derived(config.items.filter((x) => itemMatches(x, filter)));
</script>

{#each config.errors as error, i (i)}<div class="banner err">{error}</div>{/each}

<Facts facts={config.facts} />

{#if config.selection.length}
  <fieldset class="hgroup">
    <legend>Selected by ({config.selection.length})</legend>
    <p class="dimtext note">The SIMs the modem loads this configuration for.</p>
    <SelectionTable rules={config.selection.map(simRule)} />
  </fieldset>
{/if}

<fieldset class="hgroup">
  <legend>Settings ({config.items.length})</legend>
  <div class="filters">
    <input type="search" name="modem-filter" placeholder="filter" aria-label="filter settings" bind:value={filter} />
    {#if filter.trim()}<span class="dimtext">{items.length} shown</span>{/if}
  </div>
  {#each modemSections(items) as [section, list] (section)}
    <h3 class="mono">{section} <span class="dimtext">({list.length})</span></h3>
    <div class="tree">
      {#each list as item (item)}<ItemLine {item} items={config.items} {section} />{/each}
    </div>
  {:else}
    <p class="dimtext note">No settings{filter.trim() ? " match" : " in this configuration"}.</p>
  {/each}
</fieldset>

{#if config.combos.length}<ModemCombos sets={config.combos} />{/if}

