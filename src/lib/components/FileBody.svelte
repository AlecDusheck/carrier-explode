<script lang="ts">
  import type { DecodedFile } from "$lib/decode";
  import { humanBytes, hexDump } from "$lib/format";
  import Tree from "./Tree.svelte";
  import PriView from "./PriView.svelte";
  import PrlView from "./PrlView.svelte";
  import CertView from "./CertView.svelte";
  import SignatureView from "./SignatureView.svelte";

  let { file, cc, raw, devices = true }: {
    file: DecodedFile;
    cc?: string;
    raw: string;
    /** Off where a file picker already names the devices. */
    devices?: boolean;
  } = $props();

  let showRaw = $state(false);
  // Structured views keep the raw text or bytes one click away rather than dumping them underneath.
  const structured = $derived(!!(file.prl || file.certificates?.length || file.dmu));
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

<div class="rowflex" style="margin-bottom:6px">
  {#if devices && file.devices?.length}
    <span class="dimtext">
      {#each file.devices as d, i (i)}{i ? ", " : ""}<span title={d.ids ?? d.code}>{d.name ?? d.code}</span>{/each}
    </span>
  {/if}
  <span class="grow"></span>
  <a class="btn" href="{raw}?dl" data-sveltekit-reload title={humanBytes(file.size)}>Save</a>
  <a class="btn" href={raw} target="_blank" rel="noreferrer">Raw</a>
</div>

<!-- A signed profile's note repeats the Signature box below it. -->
{#if file.note && !file.signature}<div class="banner">{file.note}</div>{/if}

{#if file.signature}<SignatureView sig={file.signature} />{/if}

{#if file.pri}
  <PriView pri={file.pri} />
{:else if file.plist !== undefined}
  <Tree value={file.plist} ctx={{ file: file.path, cc }} />
{:else if file.kind === "image"}
  <span class="checker" style="display:inline-block; padding:10px; border:1px solid var(--shadow)">
    <img src={raw} alt={file.path} style="image-rendering:pixelated; max-width:100%; display:block" />
  </span>
{:else if structured}
  {#if file.prl}<PrlView prl={file.prl} />{/if}
  {#if file.certificates?.length}<CertView certs={file.certificates} />{/if}
  {#if file.dmu}
    {@const k = file.dmu}
    <fieldset class="hgroup">
      <legend>DMU public key</legend>
      <p class="dimtext" style="margin:0 0 6px">
        RSA key the handset uses to encrypt its Mobile IP secrets for the carrier (Dynamic Mobile IP Key Update, RFC 4784).
      </p>
      <table class="grid">
        <tbody>
          <tr><td class="k">Algorithm</td><td>{k.algorithm} <span class="dimtext">(ATV {k.atv}), DMU version {k.dmuVersion}</span></td></tr>
          <tr>
            <td class="k">Organization</td>
            <td><span class="mono">PKOID 0x{k.pkoid.toString(16).padStart(2, "0")}</span>{k.pkoidName ? " " + k.pkoidName : ""}, key index (PKOI) {k.pkoi}{k.pkExpansion ? ", expansion " + k.pkExpansion : ""}</td>
          </tr>
          <tr><td class="k">Exponent</td><td class="mono">{k.exponent}</td></tr>
          <tr><td class="k">Modulus</td><td class="mono wrap">{k.modulusBits} bits<div class="dimtext" style="font-size:10px">{k.modulus}</div></td></tr>
        </tbody>
      </table>
    </fieldset>
  {/if}
  <button class="btn" onclick={() => (showRaw = !showRaw)}>{showRaw ? "Hide" : "Show"} {file.text ? "text" : "bytes"}</button>
  {#if showRaw}{@render rawBody()}{/if}
{:else if file.audio}
  {@const a = file.audio}
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
    <audio controls preload="none" src={raw} style="margin-top:6px; max-width:100%"></audio>
  </fieldset>
{:else}
  {@render rawBody()}
{/if}
