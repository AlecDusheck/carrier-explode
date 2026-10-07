<script lang="ts">
  import type { DecodedFile } from "@carrier-explode/decode-ios";
  import type { WithPhones } from "#lib/apple/phones.ts";
  import { hexDump } from "#lib/format.ts";
  import Tree, { type TreeCtx } from "../Tree.svelte";
  import FileDevices from "./FileDevices.svelte";
  import IntelPriView from "./IntelPriView.svelte";
  import PrlView from "./PrlView.svelte";
  import CertView from "./CertView.svelte";
  import DmuView from "./DmuView.svelte";
  import AudioView from "./AudioView.svelte";
  import SignatureView from "./SignatureView.svelte";

  interface Props {
    file: WithPhones<DecodedFile>;
    /** Where the file is, for the tree's "compare across" menu. */
    ctx: TreeCtx;
    /** The member as-is, for images and audio. */
    raw: string;
    /** Off where a phone picker already names the devices and their modem. */
    devices?: boolean;
  }

  let { file, ctx, raw, devices = true }: Props = $props();

  let showRaw = $state(false);

  const view = $derived(file.view);
  const rawWord = $derived(file.raw !== null && "text" in file.raw ? "text" : "bytes");
</script>

{#snippet rawBody()}
  {#if file.raw === null}
    <p class="dimtext">Not decodable.</p>
  {:else if "text" in file.raw}
    <pre class="code">{file.raw.text}</pre>
  {:else}
    <pre class="code hex">{hexDump(file.raw.hex, true)}</pre>
  {/if}
{/snippet}

<!-- Structured views keep the raw text or bytes one click away rather than dumping them underneath. -->
{#snippet rawToggle()}
  {#if file.raw !== null}
    <button class="btn" onclick={() => (showRaw = !showRaw)}>{showRaw ? "Hide" : "Show"} {rawWord}</button>
    {#if showRaw}{@render rawBody()}{/if}
  {/if}
{/snippet}

{#if devices}<FileDevices devices={file.devices} />{/if}

{#if file.note}<div class="banner">{file.note}</div>{/if}
{#if file.error}
  <div class="banner">
    {file.error.reason === "failed" ? "Could not decode" : "Not the format its name says"}{file.error.message ? `: ${file.error.message}` : ""}; showing the raw
    {rawWord}.
  </div>
{/if}

<!-- A Qualcomm override file reads as its ModemConfig; its caller shows that instead. -->
{#if view.type === "pri"}
  <IntelPriView pri={view.pri} {devices} />
{:else if view.type === "prl"}
  <PrlView prl={view.prl} />{@render rawToggle()}
{:else if view.type === "certificates"}
  <CertView certs={view.certificates} />{@render rawToggle()}
{:else if view.type === "dmu"}
  <DmuView dmu={view.dmu} />{@render rawToggle()}
{:else if view.type === "audio"}
  <AudioView audio={view.audio} src={raw} />
{:else if view.type === "image"}
  <div class="banner">
    PNG, {view.width} by {view.height} pixels{#if view.cgbi}; Apple CgBI form, converted to standard PNG when served{/if}
  </div>
  <span class="checker frame"><img src={raw} alt={file.path} /></span>
{:else if file.kind === "image"}
  <span class="checker frame"><img src={raw} alt={file.path} /></span>
{:else if view.type === "tree"}
  {#if view.signature}<SignatureView sig={view.signature} />{/if}
  <Tree value={view.plist} {ctx} />
{:else}
  {@render rawBody()}
{/if}

<style>
  .frame { display: inline-block; padding: 10px; border: 1px solid var(--shadow); }
  img { image-rendering: pixelated; max-width: 100%; display: block; }
</style>
