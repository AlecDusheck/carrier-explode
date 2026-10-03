<script lang="ts">
  import { getBaseband, getModems } from "#lib/api/tables.remote.ts";
  import { modemCapabilities } from "#lib/decode/index.ts";
  import Pane from "#lib/components/Pane.svelte";
  import ModemFirmware from "#lib/components/ios/baseband/ModemFirmware.svelte";
  import FbsSection from "#lib/components/ios/baseband/FbsSection.svelte";
  import PowerTable from "#lib/components/ios/baseband/PowerTable.svelte";

  let { params } = $props();

  const caps = $derived(modemCapabilities(params.family));
</script>

<div class="scroll pad">
  <Pane>
    {@const mods = await getModems(params.build)}
    {@const modem = mods.modems.find((x) => x.family === params.family)!}
    <h2 class="package mono">{modem.package.name}</h2>
    <ModemFirmware {modem} {caps} version={mods.version} />
    {#if caps?.plaintextDefaults}
      {@const bb = await getBaseband({ build: params.build, family: params.family })}
      <p class="dimtext note">Load order: the modem's built-in config, then bbcfg.mbn's per-platform defaults, then the bundle's .der.pri.</p>
      {#if bb.ssgccs?.length}<FbsSection groups={bb.ssgccs} />{/if}
      {#if bb.amprNs.length}<PowerTable tables={bb.amprNs} mccs={bb.mccs} />{/if}
    {/if}
  </Pane>
</div>

<style>
  .package { font-size: 14px; margin: 2px 0 6px; overflow-wrap: anywhere; }
</style>
