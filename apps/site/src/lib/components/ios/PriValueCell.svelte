<script lang="ts">
  import type { PriValue } from "@carrier-explode/decode-ios";
  import HexBytes from "../modem/HexBytes.svelte";
  import XmlValue from "../modem/XmlValue.svelte";

  let { v, label }: { v: PriValue; label?: string | undefined } = $props();

  const wide = (x: Extract<PriValue, { kind: "int" }>) => x.len >= 4 && Number(x.exact ?? x.int) > 0xffff;
</script>

{#if v.kind === "xml"}
  <XmlValue xml={v.text} />
{:else if v.kind === "int"}
  <!-- The stored bytes stay a hover away; hex is shown only where it reads better than decimal (bitmaps). -->
  <span class="mono" title="0x{v.hex}, {v.len} bytes little-endian">{v.exact ?? v.int}{#if label}<span class="label after">= {label}</span>{/if}{#if wide(v)}<span class="dimtext after">0x{v.hex}</span>{/if}</span>
{:else if v.kind === "string"}
  <span class="mono">"{v.text}"</span>{#if label}<span class="label after">= {label}</span>{/if}
{:else if v.kind === "empty"}
  <span class="dimtext">empty</span>
{:else}
  {#if label}<span class="label before">{label}</span>{/if}<HexBytes hex={v.hex} />
{/if}

<style>
  .label { font-family: var(--ui); color: var(--meaning); }
  .after { margin-left: 0.5ch; }
  .before { margin-right: 0.5ch; }
</style>
