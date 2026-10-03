<script lang="ts">
  import { getBaseband } from "#lib/api/tables.remote.ts";
  import Pane from "#lib/components/Pane.svelte";
  import PackageConfigs from "#lib/components/ios/baseband/PackageConfigs.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    <PackageConfigs bb={await getBaseband({ build: params.build, family: params.family })} />
  </Pane>
</div>
