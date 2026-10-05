<script lang="ts">
  import { getBaseband } from "#lib/api/apple.remote.ts";
  import type { ModemProps } from "../../views.ts";
  import Pane from "../../Pane.svelte";
  import NetworkDbs from "../baseband/NetworkDbs.svelte";

  let { build, modem }: ModemProps = $props();
</script>

<div class="scroll pad">
  <Pane>
    {@const bb = await getBaseband({ build, family: modem })}
    {#if bb.mdb}<NetworkDbs mdb={bb.mdb} mccs={bb.mccs} />{:else}<p class="dimtext note">This package has no network databases.</p>{/if}
  </Pane>
</div>
