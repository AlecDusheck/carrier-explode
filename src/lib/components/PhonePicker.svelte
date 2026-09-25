<script lang="ts">
  import { modemLabel } from "$lib/decode";
  import { modemFor, sortPhones } from "$lib/phones";
  import type { ImageModem } from "./baseband/types";

  let { modems, phone, named, onpick }: {
    modems: ImageModem[];
    /** The phone shown. */
    phone: string | undefined;
    /** The URL names the phone; a remembered one only fills in a URL without one. */
    named: boolean;
    /** `restored`: the phone came from memory, not from the picker. */
    onpick: (phone: string, restored: boolean) => void;
  } = $props();

  const KEY = "baseband-phone";

  function pick(p: string) {
    try { localStorage.setItem(KEY, p); } catch { /* remembering is a convenience */ }
    onpick(p, false);
  }

  $effect(() => {
    if (named) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* no storage, no memory */ }
    if (saved && saved !== phone && modemFor(modems, saved)) onpick(saved, true);
  });
</script>

<div class="rowflex picker">
  <label class="lbl grow">
    Phone
    <select class="grow" name="phone" value={phone} onchange={(e) => pick(e.currentTarget.value)}>
      {#each modems as x (x.family)}
        <optgroup label={modemLabel(x.family)}>
          {#each sortPhones(x.devices) as d (d.id)}<option value={d.id}>{d.name ?? d.id}</option>{/each}
        </optgroup>
      {/each}
    </select>
  </label>
</div>

<style>
  .picker { margin-bottom: 4px; }
  .picker select { min-width: 0; }
</style>
