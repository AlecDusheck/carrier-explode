<script lang="ts">
  import { link } from "$lib/format";
  import { modemLabel } from "$lib/decode";
  import { phoneList } from "$lib/phones";
  import type { ImageModem, ImageModems } from "./types";

  let { mods, modem, family }: {
    mods: ImageModems;
    /** The package this page shows, when the image has one for `family`. */
    modem: ImageModem | undefined;
    family: string;
  } = $props();
</script>

<nav class="modems" aria-label="Modem packages in iOS {mods.version}">
  {#each mods.modems as x (x.family)}
    <a class="btn" href={link(`/baseband/${mods.build}/${x.family}`)} aria-current={x.family === family ? "page" : undefined}>
      <b>{modemLabel(x.family)}</b>
      <span class="phones">{phoneList(x.devices)}</span>
    </a>
  {/each}
</nav>
<div class="which">
  <h2>
    {#if modem}<span class="mono">{modem.package.name}</span>{:else}No {modemLabel(family)} package{/if}
    <span class="dimtext">in <a href={link("/releases/" + mods.build)}>iOS {mods.version} ({mods.build})</a></span>
  </h2>
</div>

<style>
  .modems { display: flex; flex-wrap: wrap; gap: 4px; }
  .modems .btn { flex-direction: column; align-items: flex-start; gap: 0; max-width: 100%; text-align: left; }
  .modems .phones { font-size: 10.5px; color: var(--text-dim); }
  .which h2 { font-size: 14px; margin: 10px 0 2px; }
  .which h2 .dimtext { font-weight: normal; font-size: 12px; }
  @media (max-width: 760px) {
    .modems .phones { display: none; }
    .modems .btn { min-height: 40px; justify-content: center; }
  }
</style>
