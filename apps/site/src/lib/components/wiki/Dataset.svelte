<!-- The dataset archive, linked, with its size, date and digest as its metadata states them now. -->
<script lang="ts">
  import { getDataset } from "#lib/api/dataset.remote.ts";
  import { humanBytes } from "#lib/format.ts";
  import Live from "./Live.svelte";
</script>

<Live>
  {@const facts = await getDataset()}
  {#if facts}
    <a href="/datasets/carrier-explode.zip" download><code>carrier-explode.zip</code></a>: {humanBytes(Number(facts.size))}, updated {facts.date}, SHA-256 <code>{facts.sha256}</code>.
  {:else}
    Not built yet.
  {/if}
</Live>
