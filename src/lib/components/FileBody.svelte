<script lang="ts">
  import type { DecodedFile } from "$lib/server/ipcc";
  import { humanBytes, hexDump } from "$lib/format";
  import Tree from "./Tree.svelte";
  import PriView from "./PriView.svelte";

  let { file, cc, raw }: { file: DecodedFile; cc?: string; raw: string } = $props();
</script>

<div class="rowflex" style="margin-bottom:6px">
  <span class="chip">{file.kind}</span>
  <span class="dimtext">{humanBytes(file.size)}</span>
  {#each file.devices ?? [] as d, i (i)}
    <span class="chip" title={d.ids ?? ""}>{d.code}{d.name ? " " + d.name : ""}</span>
  {/each}
  <span class="grow"></span>
  <a class="btn" href="{raw}?dl" data-sveltekit-reload>Save</a>
  <a class="btn" href={raw} target="_blank" rel="noreferrer">Raw</a>
</div>

{#if file.note}<div class="banner">{file.note}</div>{/if}

{#if file.pri}
  <PriView pri={file.pri} />
{:else if file.plist !== undefined}
  <Tree value={file.plist} ctx={{ file: file.path, cc }} />
{:else if file.kind === "image"}
  <span class="checker" style="display:inline-block; padding:10px; border:1px solid var(--shadow)">
    <img src={raw} alt={file.path} style="image-rendering:pixelated; max-width:100%; display:block" />
  </span>
{:else if file.text}
  <pre class="code">{file.text}</pre>
{:else if file.hex}
  <pre class="code hex">{hexDump(file.hex, true)}</pre>
{:else}
  <p class="dimtext">Not decodable.</p>
{/if}
