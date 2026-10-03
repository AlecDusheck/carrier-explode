<script lang="ts">
  import type { CarrierConfigValue } from "#lib/decode/android/types.ts";
  import Self from "./ConfigValue.svelte";

  /** One CarrierConfig value in its own type: booleans and numbers as such, arrays as lists, bundles as nested keys. */
  let { value }: { value: CarrierConfigValue } = $props();
</script>

{#if value.type === "bundle"}
  {#each Object.entries(value.value) as [k, v] (k)}
    <div><span class="dimtext">{k}</span> = <Self value={v} /></div>
  {/each}
{:else if value.type === "text_array" || value.type === "int_array"}
  {#if value.value.length}{value.value.join(", ")}{:else}<span class="dimtext">empty list</span>{/if}
{:else if value.type === "text"}
  <span class="val str">"{value.value}"</span>
{:else if value.type === "bool"}
  <span class="val bool">{value.value}</span>
{:else}
  <span class="val num">{value.value}</span>
{/if}
