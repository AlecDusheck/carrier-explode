<script lang="ts">
  import { page } from "$app/state";
  import { getModemConfigBySha, getModemFirmware } from "#lib/api/android.remote.ts";
  import { phoneList } from "#lib/apple/phones.ts";
  import { configHref } from "#lib/android/links.ts";
  import type { ModemProps } from "../../views.ts";
  import Pane from "../../Pane.svelte";
  import TabLinks from "../../TabLinks.svelte";
  import ModemConfigView from "../../modem/ModemConfigView.svelte";

  /** The modem firmware a group of Pixels runs in an Android build, and the configurations it carries for no carrier in particular. */
  let { build, modem }: ModemProps = $props();

  const chosen = $derived(page.url.searchParams.get("config"));
  const KINDS = { base: "base layers", default: "loaded for any SIM" } as const;
</script>

<div class="scroll pad">
  <Pane>
    {@const fw = await getModemFirmware({ build, device: modem })}
    {#if fw}
      <h2 class="package mono">{fw.modem.firmware}</h2>
      <table class="grid fit">
        <tbody>
          <tr><td class="k">Modem</td><td>{fw.modem.label}</td></tr>
          <tr><td class="k">Pixels</td><td>{phoneList(fw.modem.devices)}</td></tr>
        </tbody>
      </table>
      <p class="dimtext note">Carrier configurations are on each carrier's Modem tab.</p>
      {@const shown = fw.configs.find((c) => c.sha === chosen) ?? fw.configs[0]}
      {#if chosen !== null && shown?.sha !== chosen}<div class="banner">No configuration <span class="mono">{chosen}</span> is this firmware's own.</div>{/if}
      {#if shown}
        <nav class="tabs">
          <TabLinks
            items={fw.configs.map((c): [string, string] => [configHref(build, modem, c.sha), `${c.label} (${KINDS[c.kind]})`])}
            current={configHref(build, modem, shown.sha)}
          />
        </nav>
        <ModemConfigView config={await getModemConfigBySha(shown.sha)} />
      {:else}
        <p class="dimtext note">This firmware carries no configuration of its own.</p>
      {/if}
    {/if}
  </Pane>
</div>

<style>
  .package { font-size: 14px; margin: 2px 0 6px; overflow-wrap: anywhere; }
</style>
