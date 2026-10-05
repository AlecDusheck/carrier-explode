<script lang="ts">
  import type { ModemValue } from "@carrier-explode/schema/types";
  import FlagGrid from "./FlagGrid.svelte";
  import HexBytes from "./HexBytes.svelte";
  import XmlValue from "./XmlValue.svelte";
  import Self from "./ItemValue.svelte";

  /** A modem item's value, beside its label; `inline` writes fields on one line, as entries of a list. */
  let { value, label, inline = false }: { value: ModemValue; label: string | null; inline?: boolean } = $props();
  let open = $state(false);

  // Numbers read inline at any length; past this many entries any other list sits behind a chip.
  const LONG = 8;
  // Up to a word's width, bytes read inline as hex; longer ones sit behind the dump's chip.
  const SHORT = 8;
  const folded = $derived(value.kind === "list" && value.values.length > LONG && value.values.some((v) => v.kind !== "number"));
</script>

{#if value.kind === "number"}
  <!-- Hex is shown only where it reads better than decimal (bitmaps); it is always a hover away. -->
  <span class="mono" title="0x{value.value.toString(16)}">{value.value}{#if label}<span class="label after">= {label}</span>{/if}{#if value.value > 0xffff}<span class="dimtext after">0x{value.value.toString(16)}</span>{/if}</span>
{:else if value.kind === "text"}
  <span class="mono">"{value.value}"</span>{#if label}<span class="label after">= {label}</span>{/if}
{:else if value.kind === "xml"}
  <XmlValue xml={value.value} />
{:else if value.kind === "bytes"}
  {#if !value.hex}
    <!-- An item written without data says so ("No value") as a badge, in place of its empty bytes. -->
    {#if label}<span class="badge">{label}</span>{:else}<span class="dimtext">empty</span>{/if}
  {:else}
    {#if label}<span class="label before">{label}</span>{/if}
    {#if value.hex.length <= SHORT * 2}<span class="mono">{value.hex}</span>{:else}<HexBytes hex={value.hex} />{/if}
  {/if}
{:else if value.kind === "flags"}
  <FlagGrid flags={value.values} notes={label} />
{:else if value.kind === "list"}
  {#if !value.values.length}
    <span class="dimtext">empty list</span>
  {:else if folded}
    <button class="chip" onclick={() => (open = !open)}>{open ? "hide" : "show"} list, {value.values.length} entries</button>
    {#if open}
      <div class="list">{#each value.values as v, i (i)}<div><Self value={v} label={null} inline /></div>{/each}</div>
    {/if}
  {:else}
    {#each value.values as v, i (i)}{#if i}{", "}{/if}<Self value={v} label={null} inline />{/each}
  {/if}
  {#if label}<div class="label">{label}</div>{/if}
{:else if inline}
  {#each Object.entries(value.fields) as [k, v], i (k)}{#if i}{" "}{/if}<span class="dimtext">{k}</span>=<Self value={v} label={null} inline />{/each}
{:else}
  {#each Object.entries(value.fields) as [k, v] (k)}
    <div><span class="dimtext">{k}</span> = <Self value={v} label={null} /></div>
  {/each}
  {#if label}<div class="label">{label}</div>{/if}
{/if}

<style>
  .label { font-family: var(--ui); color: var(--meaning); }
  .after { margin-left: 0.5ch; }
  .before { margin-right: 0.5ch; }
  .list { font-size: 11px; }
</style>
