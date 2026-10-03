<script lang="ts">
  import { getBundle } from "#lib/api/bundles.remote.ts";
  import { bundleArgs } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import Overview from "#lib/components/Overview.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    <Overview bundle={await getBundle(bundleArgs(params))} />
  </Pane>
</div>
