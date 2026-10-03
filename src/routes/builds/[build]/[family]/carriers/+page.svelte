<script lang="ts">
  import { getBaseband } from "#lib/api/tables.remote.ts";
  import Pane from "#lib/components/Pane.svelte";
  import CarrierCombos from "#lib/components/ios/baseband/CarrierCombos.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    {@const bb = await getBaseband({ build: params.build, family: params.family })}
    <CarrierCombos id={bb.id} bandCombos={bb.bandCombos} carrierMap={bb.carrierMap} />
  </Pane>
</div>
