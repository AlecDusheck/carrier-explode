<script lang="ts">
  import { getBuildModems, getBuilds } from "#lib/api/builds.remote.ts";
  import { phoneList } from "#lib/apple/phones.ts";
  import { modemHref } from "#lib/format.ts";
  import type { BuildModem } from "#lib/server/builds.ts";
  import type { ModemProps } from "../../views.ts";
  import BuildPicker from "../../BuildPicker.svelte";
  import Pane from "../../Pane.svelte";
  import Picker from "../../Picker.svelte";

  /** A Pixel modem firmware's head, laid out as an iOS modem package's: the firmware in place of the package, the Android build in place of the iOS version. */
  let { build, modem }: ModemProps = $props();
</script>

{#snippet option(m: BuildModem)}
  <span class="picker-opt"><span class="text">{m.label} · {phoneList(m.devices)}</span></span>
{/snippet}

<div class="bundle-head">
  <div class="ident">
    <Pane quiet>
      {@const mods = await getBuildModems({ platform: "android", build })}
      <Picker items={mods} selected={mods.find((m) => m.id === modem)} key={(m) => m.id} {option} href={(m) => modemHref("android", build, m.id)} />
    </Pane>
  </div>
  <div class="versions-slot">
    <Pane quiet>
      <!-- Another build names this firmware by the same Pixel, which may not be its newest there: that page sends it on to its own. -->
      <BuildPicker
        builds={(await getBuilds()).filter((b) => b.platform === "android" && b.devices.includes(modem))}
        current={build}
        href={(b) => modemHref("android", b.id, modem)}
      />
    </Pane>
  </div>
</div>
