<script lang="ts">
  import type { CafInfo } from "$lib/decode";

  let { audio: a, src }: { audio: CafInfo; src: string } = $props();
</script>

<fieldset class="hgroup">
  <legend>Audio</legend>
  <table class="grid">
    <tbody>
      <tr><td class="k">Format</td><td><span class="mono">{a.format.trim()}</span>{a.encoding ? ", " + a.bitsPerChannel + "-bit " + a.encoding : ""}</td></tr>
      <tr><td class="k">Sample rate</td><td>{a.sampleRate} Hz</td></tr>
      <tr><td class="k">Channels</td><td>{a.channels}</td></tr>
      {#if a.duration !== undefined}<tr><td class="k">Duration</td><td>{a.duration} s</td></tr>{/if}
    </tbody>
  </table>
  <audio controls preload="none" {src}></audio>
</fieldset>

<style>
  audio { margin-top: 6px; max-width: 100%; }
</style>
