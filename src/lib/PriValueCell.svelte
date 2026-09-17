<script lang="ts">
  import type { PriValue } from "../../worker/lib/pri.ts";

  let { v }: { v: PriValue } = $props();
  let open = $state(false);

  const hexDump = $derived(
    (v.hex.match(/.{1,32}/g) ?? []).map((g) => (g.match(/.{1,2}/g) ?? []).join(" ")).join("\n"),
  );
</script>

{#if v.kind === "xml"}
  <button class="chip warn" onclick={() => (open = !open)}>{open ? "hide" : "show"} XML, {v.len} bytes</button>
  {#if open}<pre class="code">{v.xml}</pre>{/if}
{:else if v.kind === "int"}
  <span class="mono">{v.exact ?? v.int}<span class="dimtext"> 0x{v.hex} {v.len}B LE</span></span>
{:else if v.kind === "string"}
  <span class="mono">"{v.text}"</span>
{:else if v.kind === "empty"}
  <span class="dimtext">empty</span>
{:else}
  <button class="chip" onclick={() => (open = !open)}>{open ? "hide" : "hex"}, {v.len} bytes</button>
  {#if open}<pre class="code hex">{hexDump}</pre>{/if}
{/if}
