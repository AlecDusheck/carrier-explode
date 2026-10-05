<script lang="ts">
  import type { ModemItem } from "@carrier-explode/schema/types";
  import { CONFIDENCE, itemNote } from "#lib/modem.ts";
  import Confidence from "../Confidence.svelte";
  import TreeRow from "../TreeRow.svelte";
  import LazyView from "../values/LazyView.svelte";
  import { modemView } from "../values/registry.ts";
  import ItemValue from "./ItemValue.svelte";

  /** A modem item as a tree line, `name = value`, its description under it; a structure or a view folds beneath. */
  let { item, items, section }: { item: ModemItem; items: readonly ModemItem[]; section: string } = $props();

  let raw = $state(false);
  const view = $derived(modemView(item, items));
  const shown = $derived(raw ? null : view);
  const folds = $derived(!!shown || item.value.kind === "fields" || item.value.kind === "flags");
  const note = $derived(itemNote(item, section));
</script>

{#snippet line()}
  <span class="key">{item.name ?? item.id}</span>{#if item.name}<Confidence c={CONFIDENCE[item.certainty]} />{/if}
  {#if view}<button type="button" class="chip sp" onclick={() => (raw = !raw)}>{raw ? "decoded" : "raw"}</button>{/if}
  {#if !folds}
    <span class="type"> = </span>
    <ItemValue value={item.value} label={item.label} />
  {/if}
{/snippet}

{#snippet under()}
  {#if note || item.name}
    <span class="note">{note}{#if item.name}<span class="id" class:sp={!!note}>{item.id}</span>{/if}</span>
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
