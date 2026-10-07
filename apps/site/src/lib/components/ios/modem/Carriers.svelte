<script lang="ts">
  import { getBaseband } from "#lib/api/apple.remote.ts";
  import type { ModemProps } from "../../views.ts";
  import Pane from "../../Pane.svelte";
  import CarrierCombos from "../baseband/CarrierCombos.svelte";

  let { build, modem }: ModemProps = $props();
</script>

<div class="scroll pad">
  <Pane awaiting={{ kind: "decode", name: modem }}>
    {@const bb = await getBaseband({ build, family: modem })}
    <CarrierCombos id={bb.id} bandCombos={bb.bandCombos} tagBundles={bb.tagBundles} />
  </Pane>
</div>
