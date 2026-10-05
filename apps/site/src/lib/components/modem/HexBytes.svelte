<script lang="ts">
  import { hexDump } from "#lib/format.ts";

  /** Raw bytes behind a chip; the dump opens on a click. */
  let { hex }: { hex: string } = $props();
  let open = $state(false);
</script>

<button class="chip" onclick={() => (open = !open)}>{open ? "hide" : "hex"}, {hex.length / 2} bytes</button>
{#if open}<pre class="code hex">{hexDump(hex)}</pre>{/if}
