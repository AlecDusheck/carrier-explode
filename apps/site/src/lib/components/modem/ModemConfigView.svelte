<script lang="ts">
  import { page } from "$app/state";
  import { getModemSections } from "#lib/api/modem.remote.ts";
  import type { ModemConfigRef } from "#lib/api/schemas.ts";
  import { withParams } from "#lib/format.ts";
  import type { ModemHead } from "#lib/modem.ts";
  import { selectionRows, simRule } from "#lib/settings.ts";
  import SelectionTable from "../SelectionTable.svelte";
  import DecodeNotes from "./DecodeNotes.svelte";
  import Facts from "./Facts.svelte";
  import ModemCombos from "./ModemCombos.svelte";
  import ModemItems from "./ModemItems.svelte";

  /** One modem configuration of any family: its header, the SIMs that select it, its settings and its band combinations, each marked where it did not decode. */
  let { ref, head }: { ref: ModemConfigRef; head: ModemHead } = $props();

  // In the URL, so a link can name the settings to show, and the server draws only those.
  const filter = $derived(page.url.searchParams.get("filter")?.trim() ?? "");
  const sections = $derived(await getModemSections({ ref, filter }));
  // Another configuration's section (a page can show several, and a phone picker keeps the URL's) is not this one's.
  const section = $derived(sections.find((s) => s.title === page.url.searchParams.get("section"))?.title ?? null);
  const matched = $derived(sections.reduce((n, s) => n + s.count, 0));
  // A new filter searches every section.
  const kept = $derived([...page.url.searchParams].filter(([k]) => k !== "filter" && k !== "section"));
</script>

<Facts facts={head.facts} />

{#if head.selection.length}
  <fieldset class="hgroup">
    <legend>Selected by ({selectionRows(head.selection.map(simRule)).length})</legend>
    <p class="dimtext note">The SIMs the modem loads this configuration for.</p>
    <SelectionTable rules={head.selection.map(simRule)} />
  </fieldset>
{/if}

<fieldset class="hgroup">
  <legend>Settings ({head.listed})<DecodeNotes errors={head.unplaced} /></legend>
  <form class="filters" method="get" data-sveltekit-keepfocus data-sveltekit-noscroll>
    {#each kept as [k, v] (k)}<input type="hidden" name={k} value={v} />{/each}
    <input type="search" name="filter" placeholder="filter" aria-label="filter settings" value={filter} />
    {#if filter}<span class="dimtext">{matched} shown</span>{/if}
  </form>
  {#if sections.length > 1}
    <nav class="rowflex sections" aria-label="sections" data-sveltekit-noscroll>
      <a class="btn" href={withParams(page.url, { section: null })} aria-current={section === null ? "page" : undefined}>All ({matched})</a>
      {#each sections as s (s.title)}
        <a class="btn mono" href={withParams(page.url, { section: s.title })} aria-current={section === s.title ? "page" : undefined}>{s.title} ({s.count})</a>
      {/each}
    </nav>
  {/if}
  {#if matched}
    {#key JSON.stringify([ref, filter, section])}<ModemItems {ref} {filter} {section} {sections} />{/key}
  {:else}
    <p class="dimtext note">No settings{filter ? " match" : head.unplaced.length ? " decoded" : " in this configuration"}.</p>
  {/if}
</fieldset>

{#if head.combos.length}<ModemCombos sets={head.combos} />{/if}

<style>
  .sections { margin: 4px 0 8px; }
  .sections .btn { overflow-wrap: anywhere; }
</style>
