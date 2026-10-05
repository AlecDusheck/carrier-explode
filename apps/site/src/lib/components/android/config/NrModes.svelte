<script lang="ts">
  import type { ConfigFormats } from "@carrier-explode/decode-android";
  import NotUnderstood from "../../values/NotUnderstood.svelte";

  let { value }: { value: ConfigFormats["nr-modes"] } = $props();
</script>

{#each value as e, i (i)}
  {#if e.ok}<span class="chip">{e.value}</span>{:else}<span class="chip">{e.text}</span><NotUnderstood reason={e.reason} />{/if}
{:else}
  <span class="dimtext">none: no 5G</span>
{/each}
