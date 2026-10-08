<script lang="ts">
  import { page } from "$app/state";
  import type { NamedModemConfig } from "@carrier-explode/db";
  import { getModemConfigBySha, getModemFirmware } from "#lib/api/android.remote.ts";
  import { baseHref, configHref } from "#lib/android/links.ts";
  import type { DeviceReleasePlatform } from "@carrier-explode/schema/types";
  import type { ModemProps } from "../../views.ts";
  import Pane from "../../Pane.svelte";
  import Picker from "../../Picker.svelte";
  import ModemConfigView from "../../modem/ModemConfigView.svelte";

  /** The modem firmware a group of Pixels or Galaxies runs in a build, and one of the configurations it carries. */
  let { platform, build, modem }: ModemProps<DeviceReleasePlatform> = $props();

  const chosen = $derived(page.url.searchParams.get("config"));
  const onBase = $derived(page.url.searchParams.has("base"));
</script>

{#snippet option(c: NamedModemConfig)}
  <span class="picker-opt" title={c.label}><span class="text">{c.label}{#if c.name} <span class="dimtext">{c.name}</span>{/if}</span></span>
{/snippet}

<div class="scroll pad">
  <Pane awaiting={{ kind: "decode", name: modem }}>
    {@const fw = await getModemFirmware({ platform, build, device: modem })}
    {#if fw}
      <h2 class="package mono">{fw.modem.firmware}</h2>
      {@const shown = fw.configs.find((c) => c.sha === chosen)}
      {#if chosen !== null && !shown}<div class="banner">This firmware carries no configuration <span class="mono">{chosen}</span>.</div>{/if}
      {#if fw.configs.length}
        <div class="choice">
          <Picker label="Configuration" items={fw.configs} selected={shown} key={(c) => c.sha} {option} href={(c) => configHref(platform, build, modem, c.sha)} search={(c) => `${c.label} ${c.name ?? ""}`} />
        </div>
      {:else}
        <p class="dimtext note">This firmware carries no configuration.</p>
      {/if}
      {#if shown}
        {@const config = await getModemConfigBySha(shown.sha)}
        {#if config.base}
          <p class="note">
            {#if onBase}<a href={configHref(platform, build, modem, shown.sha)}>Own layers</a> · <b>Base layers</b>{:else}<b>Own layers</b> · <a href={baseHref(platform, build, modem, shown.sha)}>Base layers</a>{/if}
          </p>
        {:else if onBase}
          <div class="banner"><span class="mono">{shown.label}</span> is built on no base layers.</div>
        {/if}
        <ModemConfigView config={onBase && config.base ? await getModemConfigBySha(config.base) : config} />
      {/if}
    {/if}
  </Pane>
</div>

<style>
  .package { font-size: 14px; margin: 2px 0 6px; overflow-wrap: anywhere; }
  .choice { margin: 0 0 8px; }
</style>
