<script lang="ts">
  import type { PriValue } from "$lib/decode";
  import { hexDump } from "$lib/format";

  let { v, label }: { v: PriValue; label?: string } = $props();
  let open = $state(false);

  const wide = (x: PriValue) => x.len >= 4 && Number(x.exact ?? x.int) > 0xffff;
</script>

{#if v.kind === "xml"}
  <button class="chip warn" onclick={() => (open = !open)}>{open ? "hide" : "show"} XML, {v.len} bytes</button>
  {#if open}<pre class="code">{v.xml}</pre>{/if}
{:else if v.kind === "int"}
  <!-- The stored bytes stay a hover away; hex is shown only where it reads better than decimal (bitmaps). -->
  <span class="mono" title="0x{v.hex}, {v.len} bytes little-endian">{v.exact ?? v.int}{#if label}{" "}<span class="label">= {label}</span>{/if}{#if wide(v)}{" "}<span class="dimtext">0x{v.hex}</span>{/if}</span>
{:else if v.kind === "string"}
  <span class="mono">"{v.text}"</span>{#if label}{" "}<span class="label">= {label}</span>{/if}
{:else if v.kind === "empty"}
  <span class="dimtext">empty</span>
{:else}
  <button class="chip" onclick={() => (open = !open)}>{open ? "hide" : "hex"}, {v.len} bytes</button>
  {#if open}<pre class="code hex">{hexDump(v.hex)}</pre>{/if}
{/if}

<style>
  .label { font-family: var(--ui); color: #5b3d0c; }
</style>
