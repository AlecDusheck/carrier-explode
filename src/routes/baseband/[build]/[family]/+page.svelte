<script lang="ts">
  import { goto } from "$app/navigation";
  import { getBaseband, getBasebandBuilds, getModems } from "$lib/api/tables.remote";
  import { modemCapabilities } from "$lib/decode";
  import { link } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";
  import ModemNav from "$lib/components/baseband/ModemNav.svelte";
  import FbsSection from "$lib/components/baseband/FbsSection.svelte";
  import CarrierCombos from "$lib/components/baseband/CarrierCombos.svelte";
  import PolicyFiles from "$lib/components/baseband/PolicyFiles.svelte";
  import PowerTable from "$lib/components/baseband/PowerTable.svelte";
  import NetworkDbs from "$lib/components/baseband/NetworkDbs.svelte";
  import PackageConfigs from "$lib/components/baseband/PackageConfigs.svelte";
  import BasebandDiffSection from "$lib/components/baseband/BasebandDiffSection.svelte";
  import ModemFirmware from "$lib/components/baseband/ModemFirmware.svelte";
  import type { Baseband } from "$lib/components/baseband/types";

  let { params } = $props();

  const SECTIONS = [
    { id: "fbs", label: "Fake base stations", shown: (bb: Baseband) => !!bb.ssgccs?.length },
    { id: "carriers", label: "Carriers" },
    { id: "policy", label: "Policy files" },
    { id: "power", label: "Power", shown: (bb: Baseband) => bb.amprNs.length > 0 },
    { id: "networks", label: "Network databases", shown: (bb: Baseband) => !!bb.mdb },
    { id: "configs", label: "Configs" },
    { id: "diff", label: "Diff" },
  ] as const;

  const caps = $derived(modemCapabilities(params.family));
  // Packages with plaintext defaults get the full view; one request serves its section links and its sections.
  const baseband = $derived(caps?.plaintextDefaults ? getBaseband({ build: params.build, family: params.family }) : null);
  const sectionsOf = (bb: Baseband) => SECTIONS.filter((s) => !("shown" in s) || s.shown(bb));
</script>

<div class="view">
  <Pane>
    {@const [builds, mods] = await Promise.all([getBasebandBuilds(), getModems(params.build)])}
    {@const others = builds.filter((b) => b.families.includes(params.family) && b.build !== params.build)}
    {@const modem = mods.modems.find((x) => x.family === params.family)}
    <div class="toolbar">
      <label class="lbl">
        Image
        <select
          name="build"
          value={params.build}
          onchange={(e) => {
            const b = builds.find((x) => x.build === e.currentTarget.value);
            if (b) goto(link(`/baseband/${b.build}` + (b.families.includes(params.family) ? `/${params.family}` : "")));
          }}
        >
          {#if !builds.some((b) => b.build === params.build)}<option value={params.build}>{params.build}</option>{/if}
          {#each builds as b (b.build)}
            <option value={b.build} disabled={!b.families.length && b.build !== params.build}>iOS {b.version} ({b.build}){b.families.length ? "" : " - not extracted"}</option>
          {/each}
        </select>
      </label>
      <span class="grow"></span>
      {#if baseband}
        <Pane quiet>
          {#each sectionsOf(await baseband) as s (s.id)}<a class="btn" href="#{s.id}">{s.label}</a>{/each}
        </Pane>
      {/if}
    </div>

    <div class="scroll pad">
      <ModemNav {mods} {modem} family={params.family} />

      {#if baseband}
        <Pane>
          {@const bb = await baseband}
          <p class="lead dimtext order">
            Load order: the modem's built-in config, then bbcfg.mbn's per-platform defaults, then the bundle's .der.pri.
          </p>
          {#if bb.ssgccs?.length}<FbsSection groups={bb.ssgccs} />{/if}
          <CarrierCombos id={bb.id} bandCombos={bb.bandCombos} carrierMap={bb.carrierMap} />
          <PolicyFiles id={bb.id} files={bb.files} />
          {#if bb.amprNs.length}<PowerTable tables={bb.amprNs} mccs={bb.mccs} />{/if}
          {#if bb.mdb}<NetworkDbs mdb={bb.mdb} mccs={bb.mccs} />{/if}
          <PackageConfigs {bb} />
          <BasebandDiffSection build={params.build} family={bb.family} {others} />
        </Pane>
      {:else if modem}
        <Pane>
          <ModemFirmware {modem} {caps} version={mods.version} {others} />
        </Pane>
      {/if}
    </div>
  </Pane>
</div>

<style>
  .order { margin: 6px 0 0; }
</style>
