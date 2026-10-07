<script lang="ts">
  import type { ModemItem } from "@carrier-explode/schema/types";
  import { CONFIDENCE, hashedId, itemNote } from "#lib/modem.ts";
  import Confidence from "../Confidence.svelte";
  import TreeRow from "../TreeRow.svelte";
  import LazyView from "../values/LazyView.svelte";
  import { modemView } from "../values/registry.ts";
  import DecodeNotes from "./DecodeNotes.svelte";
  import ItemValue from "./ItemValue.svelte";

  /** A modem item as a tree line, `name = value`, its description under it; a structure or a view folds beneath. */
  let { item, items, section, errors }: { item: ModemItem; items: readonly ModemItem[]; section: string; errors: readonly string[] } = $props();

  let raw = $state(false);
  const view = $derived(modemView(item, items));
  const shown = $derived(raw ? null : view);
  const folds = $derived(!!shown || item.value.kind === "fields" || item.value.kind === "flags");
  const note = $derived(itemNote(item, section));
  // Nearly every named item is "likely"; only a weaker reading is worth a badge on every line.
  const doubt = $derived(item.name && item.certainty !== "medium" ? CONFIDENCE[item.certainty] : undefined);
  const idLine = $derived(!!item.name && !hashedId(item));
</script>

{#snippet line()}
  <span class="key" title={item.name && hashedId(item) ? item.id : undefined}>{item.name ?? item.id}</span><Confidence c={doubt} /><DecodeNotes {errors} />
  {#if view}<button type="button" class="chip sp" onclick={() => (raw = !raw)}>{raw ? "decoded" : "raw"}</button>{/if}
  {#if !folds}
    <span class="type"> = </span>
    <ItemValue value={item.value} label={item.label} />
  {/if}
{/snippet}

{#snippet under()}
  {#if note || idLine}
    <span class="note">{note}{#if idLine}<span class="id" class:sp={!!note}>{item.id}</span>{/if}</span>
  {/if}
{/snippet}

{#snippet body()}
  {#if shown}<LazyView view={shown} />{:else}<ItemValue value={item.value} label={item.label} />{/if}
{/snippet}

<TreeRow {line} {under} body={folds ? body : undefined} open />

<style>
  /* Ids and Shannon names are single long words; on a phone they break rather than widen the page. */
  .key, .id { overflow-wrap: anywhere; }
  .id { font: 10.5px var(--mono); font-style: normal; }
</style>
