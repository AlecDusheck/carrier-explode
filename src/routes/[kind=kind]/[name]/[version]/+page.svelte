<script lang="ts">
  import { getBundle } from "#lib/api/bundles.remote.ts";
  import { bundleArgs } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import Summary from "#lib/components/Summary.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    <Summary bundle={await getBundle(bundleArgs(params))} />
  </Pane>
</div>
