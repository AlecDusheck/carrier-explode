<script lang="ts">
  import { getBaseband, getModemPackages } from "#lib/api/apple.remote.ts";
  import { modemCapabilities } from "@carrier-explode/decode-ios";
  import type { ModemProps } from "../../views.ts";
  import Pane from "../../Pane.svelte";
  import FbsSection from "../baseband/FbsSection.svelte";
  import ModemFirmware from "../baseband/ModemFirmware.svelte";
  import PowerTable from "../baseband/PowerTable.svelte";

  let { build, modem }: ModemProps = $props();

  const caps = $derived(modemCapabilities(modem));
</script>

<div class="scroll pad">
  <Pane awaiting={{ kind: "decode", name: modem }}>
    {@const mods = await getModemPackages(build)}
    {@const pkg = mods.modems.find((x) => x.family.code === modem)}
    {#if pkg}
      <h2 class="package mono">{pkg.package.name}</h2>
      <ModemFirmware modem={pkg} {caps} defaultBundle={mods.defaultBundle} />
    {/if}
    {#if caps?.plaintextDefaults}
      {@const bb = await getBaseband({ build, family: modem })}
      {#if bb.ssgccs?.length}<FbsSection groups={bb.ssgccs} />{/if}
      {#if bb.amprNs.length}<PowerTable tables={bb.amprNs} mccs={bb.mccs} />{/if}
    {/if}
  </Pane>
</div>

<style>
  .package { font-size: 14px; margin: 2px 0 6px; overflow-wrap: anywhere; }
</style>
