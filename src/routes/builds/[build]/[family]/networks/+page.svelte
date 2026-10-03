<script lang="ts">
  import { getBaseband } from "#lib/api/tables.remote.ts";
  import Pane from "#lib/components/Pane.svelte";
  import NetworkDbs from "#lib/components/ios/baseband/NetworkDbs.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    {@const bb = await getBaseband({ build: params.build, family: params.family })}
    {#if bb.mdb}<NetworkDbs mdb={bb.mdb} mccs={bb.mccs} />{:else}<p class="dimtext note">This package has no network databases.</p>{/if}
  </Pane>
</div>
