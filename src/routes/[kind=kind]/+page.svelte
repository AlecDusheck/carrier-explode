<script lang="ts">
  import { link } from "#lib/format.ts";

  let { params } = $props();
</script>

<div class="scroll pad">
  <p class="dimtext note">Pick a bundle from the list. Right-click a setting to compare it across bundles.</p>
  {#if params.kind === "carriers"}
    <a class="btn" href={link("/sim")}>Find the bundle for a SIM</a>
  {/if}
</div>
