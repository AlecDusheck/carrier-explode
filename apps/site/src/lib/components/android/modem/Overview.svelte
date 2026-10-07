<script lang="ts">
  import { page } from "$app/state";
  import { getModemConfigBySha, getModemFirmware } from "#lib/api/android.remote.ts";
  import { configHref } from "#lib/android/links.ts";
  import type { FirmwareConfig } from "#lib/server/android/modems.ts";
  import type { DeviceReleasePlatform } from "@carrier-explode/schema/types";
  import type { ModemProps } from "../../views.ts";
  import Pane from "../../Pane.svelte";
  import Picker from "../../Picker.svelte";
  import ModemConfigView from "../../modem/ModemConfigView.svelte";

  /** The modem firmware a group of Pixels or Galaxies runs in a build, and the configurations it carries for no carrier in particular. */
  let { platform, build, modem }: ModemProps<DeviceReleasePlatform> = $props();

  const chosen = $derived(page.url.searchParams.get("config"));
</script>

{#snippet option(c: FirmwareConfig)}
  <span class="picker-opt" title={c.label}><span class="text">{c.kind === "base" ? "Base layers" : c.label}</span></span>
{/snippet}

<div class="scroll pad">
  <Pane awaiting={{ kind: "decode", name: modem }}>
    {@const fw = await getModemFirmware({ platform, build, device: modem })}
    {#if fw}
      <h2 class="package mono">{fw.modem.firmware}</h2>
      {@const shown = fw.configs.find((c) => c.sha === chosen) ?? fw.configs[0]}
      {#if chosen !== null && shown?.sha !== chosen}<div class="banner">No configuration <span class="mono">{chosen}</span> is this firmware's own.</div>{/if}
      {#if shown}
        <div class="choice">
          <Picker label="Configuration" items={fw.configs} selected={shown} key={(c) => c.sha} {option} href={(c) => configHref(platform, build, modem, c.sha)} search={(c) => (c.kind === "base" ? `Base layers ${c.label}` : c.label)} />
        </div>
        <ModemConfigView config={await getModemConfigBySha(shown.sha)} />
      {:else}
        <p class="dimtext note">This firmware carries no configuration of its own.</p>
      {/if}
    {/if}
  </Pane>
</div>

<style>
  .package { font-size: 14px; margin: 2px 0 6px; overflow-wrap: anywhere; }
  .choice { margin: 0 0 8px; }
</style>
