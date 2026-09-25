<script lang="ts">
  import { isPlistKind, type DecodedFile, type PlistKind } from "$lib/decode";
  import { humanBytes, hexDump } from "$lib/format";
  import Tree from "./Tree.svelte";
  import PriView from "./PriView.svelte";
  import PrlView from "./PrlView.svelte";
  import CertView from "./CertView.svelte";
  import DmuView from "./DmuView.svelte";
  import AudioView from "./AudioView.svelte";
  import SignatureView from "./SignatureView.svelte";

  let { file, cc, raw, devices = true }: {
    file: DecodedFile;
    cc?: string;
    raw: string;
    /** Off where a file picker already names the devices. */
    devices?: boolean;
  } = $props();

  let showRaw = $state(false);

  const isTree = (f: DecodedFile): f is Extract<DecodedFile, { kind: PlistKind }> => isPlistKind(f.kind);
</script>

{#snippet rawBody()}
  {#if file.text}
    <pre class="code">{file.text}</pre>
  {:else if file.hex}
    <pre class="code hex">{hexDump(file.hex, true)}</pre>
  {:else}
    <p class="dimtext">Not decodable.</p>
  {/if}
{/snippet}

<!-- Structured views keep the raw text or bytes one click away rather than dumping them underneath. -->
{#snippet rawToggle()}
  <button class="btn" onclick={() => (showRaw = !showRaw)}>{showRaw ? "Hide" : "Show"} {file.text ? "text" : "bytes"}</button>
  {#if showRaw}{@render rawBody()}{/if}
{/snippet}

<div class="filters">
  {#if devices && file.devices?.length}
    <span class="dimtext">
      {#each file.devices as d, i (i)}{i ? ", " : ""}<span title={d.ids ?? d.code}>{d.name ?? d.code}</span>{/each}
    </span>
  {/if}
  <span class="grow"></span>
  <a class="btn" href="{raw}?dl" data-sveltekit-reload title={humanBytes(file.size)}>Save</a>
  <a class="btn" href={raw} target="_blank" rel="noreferrer">Raw</a>
</div>

{#if file.note}<div class="banner">{file.note}</div>{/if}
{#if file.error}
  <div class="banner">
    {file.error.reason === "failed" ? "Could not decode" : "Not the format its name says"}{file.error.message ? `: ${file.error.message}` : ""}; showing the raw
    {file.text ? "text" : "bytes"}.
  </div>
{/if}

{#if file.kind === "pri-der"}
  <PriView pri={file.pri} />
{:else if file.kind === "prl"}
  {#if file.prl}<PrlView prl={file.prl} />{@render rawToggle()}{:else}{@render rawBody()}{/if}
{:else if file.kind === "certificate"}
  {#if file.certificates.length}<CertView certs={file.certificates} />{@render rawToggle()}{:else}{@render rawBody()}{/if}
{:else if file.kind === "dmu"}
  {#if file.dmu}<DmuView dmu={file.dmu} />{@render rawToggle()}{:else}{@render rawBody()}{/if}
{:else if file.kind === "audio"}
  {#if file.audio}<AudioView audio={file.audio} src={raw} />{:else}{@render rawBody()}{/if}
{:else if file.kind === "image"}
  {#if file.image}
    <div class="banner">
      PNG, {file.image.width} by {file.image.height} pixels{#if file.image.cgbi}; Apple CgBI form, converted to standard PNG when served{/if}
    </div>
  {/if}
  <span class="checker frame"><img src={raw} alt={file.path} /></span>
{:else if isTree(file)}
  {#if file.signature}<SignatureView sig={file.signature} />{/if}
  {#if file.plist !== undefined}<Tree value={file.plist} ctx={{ file: file.path, cc }} />{:else}{@render rawBody()}{/if}
{:else}
  {@render rawBody()}
{/if}

<style>
  .frame { display: inline-block; padding: 10px; border: 1px solid var(--shadow); }
  img { image-rendering: pixelated; max-width: 100%; display: block; }
</style>
