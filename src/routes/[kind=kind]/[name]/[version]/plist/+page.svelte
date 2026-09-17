<script lang="ts">
  import { getBundle } from "$lib/api/bundles.remote";
  import { bundleArgs } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";
  import Tree from "$lib/components/Tree.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    {@const bundle = await getBundle(bundleArgs(params))}
    <Tree value={bundle.quick["carrier.plist"]} ctx={{ file: "carrier.plist", cc: bundle.cc }} />
  </Pane>
</div>
