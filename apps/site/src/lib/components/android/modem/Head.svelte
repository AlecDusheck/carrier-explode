<script lang="ts">
  import { getBuildModems, getBuilds } from "#lib/api/builds.remote.ts";
  import { phoneList } from "#lib/apple/phones.ts";
  import { modemHref } from "#lib/format.ts";
  import type { BuildModem } from "#lib/server/builds.ts";
  import type { DeviceReleasePlatform } from "@carrier-explode/schema/types";
  import type { ModemProps } from "../../views.ts";
  import BuildPicker from "../../BuildPicker.svelte";
  import Pane from "../../Pane.svelte";
  import Picker from "../../Picker.svelte";

  /** A Pixel or Galaxy modem firmware's head, laid out as an iOS modem package's: the firmware in place of the package, the build in place of the iOS version. */
  let { platform, build, modem }: ModemProps<DeviceReleasePlatform> = $props();
</script>

{#snippet option(m: BuildModem)}
  <span class="picker-opt"><span class="text">{m.label} · {phoneList(m.devices)}</span></span>
{/snippet}

<div class="bundle-head">
  <div class="ident">
    <Pane quiet>
      {@const mods = await getBuildModems({ platform, build })}
      <Picker items={mods} selected={mods.find((m) => m.id === modem)} key={(m) => m.id} {option} href={(m) => modemHref(platform, build, m.id)} />
    </Pane>
  </div>
  <div class="versions-slot">
    <Pane quiet>
      <!-- Another build names this firmware by the same device, which may not be its newest there: that page sends it on to its own. -->
      <BuildPicker
        builds={(await getBuilds()).filter((b) => b.platform === platform && b.modemFamilies.some((f) => f.devices.includes(modem)))}
        current={build}
        href={(b) => modemHref(platform, b.id, modem)}
      />
    </Pane>
  </div>
</div>
