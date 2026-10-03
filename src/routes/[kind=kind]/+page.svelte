<script lang="ts">
  import Pane from "#lib/components/Pane.svelte";
  import SimLookup from "#lib/components/SimLookup.svelte";
  import CbsOverview from "#lib/components/CbsOverview.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <p class="dimtext note">Pick a bundle from the list. Right-click a setting to compare it across bundles.</p>
  {#if params.kind === "carriers"}
    <SimLookup />
  {:else if params.kind === "countries"}
    <Pane><CbsOverview /></Pane>
  {/if}
</div>
