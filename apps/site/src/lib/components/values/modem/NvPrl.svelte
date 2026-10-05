<script lang="ts">
  import { errorMessage, hexToBytes } from "@carrier-explode/binary";
  import { decodeNvPrl, type NvPrl } from "@carrier-explode/decode-qualcomm";
  import type { ModemViewProps } from "../registry.ts";
  import ItemValue from "../../modem/ItemValue.svelte";
  import PrlView from "../../ios/PrlView.svelte";
  import NotUnderstood from "../NotUnderstood.svelte";

  /** NV 257: its header, then the PRL behind it as an iPhone's PRL file shows. */
  let { item }: ModemViewProps = $props();

  const read = $derived.by((): { ok: true; nv: NvPrl } | { ok: false; reason: string } => {
    if (item.value.kind !== "bytes") return { ok: false, reason: "not bytes" };
    try {
      return { ok: true, nv: decodeNvPrl(hexToBytes(item.value.hex)) };
    } catch (e) {
      return { ok: false, reason: errorMessage(e) };
    }
  });
</script>

{#if read.ok}
  <div class="rowflex">
    <span class="dimtext">NV header</span>
    <span class="mono">ID {read.nv.id}, {read.nv.sizeBits} bits</span>
    {#each read.nv.disagreements as d (d)}<span class="chip bad" title="the PRL behind the header says otherwise">{d}</span>{:else}<span class="chip good">matches the PRL</span>{/each}
  </div>
  <details>
    <summary>{item.label ?? "PRL"}</summary>
    <PrlView prl={read.nv.prl} />
  </details>
{:else}
  <ItemValue value={item.value} label={null} /><NotUnderstood reason={read.reason} />
{/if}
