<script lang="ts">
  import { getBundle } from "$lib/api/bundles.remote";
  import { bundleArgs } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";
  import Summary from "$lib/components/Summary.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    <Summary bundle={await getBundle(bundleArgs(params))} />
  </Pane>
</div>
