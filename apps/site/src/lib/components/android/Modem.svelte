<script lang="ts">
  import { getAndroidModems } from "#lib/api/android.remote.ts";
  import { configHref } from "#lib/android/links.ts";
  import { modemHref, verArgs } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import ModemConfigView from "../modem/ModemConfigView.svelte";

  let { at }: TabProps = $props();

  const modems = $derived(await getAndroidModems(verArgs(at)));
</script>

{#each modems as { modem, config, firmware } (modem.sha)}
  <!-- Headed by the configuration and the firmware it ships in, as the iOS tab heads an override by its file and package. -->
  <p class="note">
    <b class="mono">{modem.label}</b>
    <span class="dimtext">
      in the {modem.family.name} <a href={modemHref("android", modem.release, firmware)}>modem firmware</a> of {modem.release}{#if config.base}, on its
        <a href={configHref(modem.release, firmware, config.base)}>base layers</a>{/if}.
    </span>
  </p>
  <ModemConfigView {config} />
{:else}
  <p class="dimtext note">No modem configuration for this carrier on this Pixel.</p>
{/each}
