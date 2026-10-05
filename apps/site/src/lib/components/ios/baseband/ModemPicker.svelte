<script lang="ts">
  import { modemHref } from "#lib/format.ts";
  import { modemCapabilities } from "@carrier-explode/decode-ios";
  import { newestNamed, phoneList } from "#lib/apple/phones.ts";
  import Picker from "../../Picker.svelte";
  import PhoneImage from "../../PhoneImage.svelte";
  import type { ImageModems } from "./types";

  /**
   * The modem packages of an iOS image, as a picker: each with its newest phone and the phones it
   * serves. Switching keeps the tab, where the other package has one (only plaintext ones do).
   */
  let { mods, modem, tab }: { mods: ImageModems; modem: string; tab: string } = $props();
</script>

<Picker
  items={mods.modems}
  selected={mods.modems.find((x) => x.family.code === modem)}
  key={(x) => x.family.code}
  href={(x) => modemHref("ios", mods.build, x.family.code, modemCapabilities(x.family.code)?.plaintextDefaults ? tab : "")}
>
  {#snippet option(x)}
    <span class="picker-opt">
      <PhoneImage platform="ios" name={newestNamed(x.devices)} />
      <span class="text">{x.family.name} <span class="dimtext">{phoneList(x.devices)}</span></span>
    </span>
  {/snippet}
</Picker>
