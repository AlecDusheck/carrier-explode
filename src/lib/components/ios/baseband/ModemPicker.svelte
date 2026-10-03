<script lang="ts">
  import { modemHref } from "#lib/format.ts";
  import { modemCapabilities, modemLabel } from "#lib/decode/index.ts";
  import { newestNamed, phoneList } from "#lib/phones.ts";
  import Picker from "../../Picker.svelte";
  import PhoneImage from "../PhoneImage.svelte";
  import type { ImageModems } from "../../baseband/types";

  /**
   * The modem packages of an iOS image, as a picker: each with its newest phone and the phones it
   * serves. Switching keeps the tab, where the other package has one (only plaintext ones do).
   */
  let { mods, family, tab }: { mods: ImageModems; family: string; tab: string } = $props();
</script>

<Picker
  items={mods.modems}
  selected={mods.modems.find((x) => x.family === family)}
  key={(x) => x.family}
  href={(x) => modemHref(mods.build, x.family, modemCapabilities(x.family)?.plaintextDefaults ? tab : "")}
>
  {#snippet option(x)}
    <span class="picker-opt">
      <PhoneImage name={newestNamed(x.devices)} />
      <span class="text">{modemLabel(x.family)} <span class="dimtext">{phoneList(x.devices)}</span></span>
    </span>
  {/snippet}
</Picker>
