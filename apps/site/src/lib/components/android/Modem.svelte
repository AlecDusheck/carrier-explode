<script lang="ts">
  import { getAndroidModems } from "#lib/api/android.remote.ts";
  import { baseHref } from "#lib/android/links.ts";
  import { modemHref, verArgs } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import ModemConfigView from "../modem/ModemConfigView.svelte";

  let { at }: TabProps = $props();

  const modems = $derived(await getAndroidModems(verArgs(at)));
</script>

{#each modems as { modem, head, firmware } (modem.sha)}
  <!-- Headed by the configuration and the firmware it ships in, as the iOS tab heads an override by its file and package. -->
  <p class="note">
    <b class="mono">{modem.label}</b>
    <span class="dimtext">
      in the {modem.familyName} <a href={modemHref("android", modem.release, firmware)}>modem firmware</a> of {modem.release}{#if head.base}, on its
        <a href={baseHref("android", modem.release, firmware, modem.sha)}>base layers</a>{/if}.
    </span>
  </p>
  <ModemConfigView ref={{ kind: "stored", sha: modem.sha }} {head} />
{:else}
  <p class="dimtext note">No modem configuration for this carrier on this Pixel.</p>
{/each}
