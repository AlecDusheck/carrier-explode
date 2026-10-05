<script lang="ts">
  import type { NamedBoard } from "#lib/apple/phones.ts";

  /** The phones a bundle file's name gives: each board's phone by name, a board no device record lists by its code. */
  let { devices }: { devices: readonly NamedBoard[] } = $props();
</script>

{#each devices as d, i (i)}{i ? ", " : ""}<span title={d.product ?? d.board}>{d.name}</span>{/each}
