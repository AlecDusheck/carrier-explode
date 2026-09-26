<script lang="ts">
  import type { CmsSignature } from "$lib/decode";
  import CertView from "./CertView.svelte";

  let { sig }: { sig: CmsSignature } = $props();

  let showCerts = $state(false);
  const signerCert = (i?: number) => (i !== undefined ? sig.certificates[i] : undefined);
</script>

<fieldset class="hgroup">
  <legend>Signature</legend>
  <p class="note">
    <span class="chip warn">not verified</span>
    <span class="dimtext">CMS signature, not checked against a trust store.</span>
  </p>
  <table class="grid">
    <tbody>
      {#each sig.signers as s, i (i)}
        {@const c = signerCert(s.certificate)}
        <tr>
          <td class="k">Signer{sig.signers.length > 1 ? " " + (i + 1) : ""}</td>
          <td class="dn">
            {c?.subject ?? (s.issuer ? "issued by " + s.issuer : s.subjectKeyId ? "key id " + s.subjectKeyId : "unidentified")}
            {#if s.serial}<div class="dimtext mono">serial {s.serial}</div>{/if}
          </td>
        </tr>
        <tr><td class="k">Signed</td><td>{s.signingTime ?? "no signing time"}</td></tr>
        <tr><td class="k">Algorithms</td><td>{s.digestAlgorithm} digest, {s.signatureAlgorithm}</td></tr>
      {:else}
        <tr><td class="k">Signer</td><td class="dimtext">none</td></tr>
      {/each}
      <!-- Plain "data" content is the profile shown below; only anything else is worth a row. -->
      {#if sig.detached || sig.contentType !== "data"}
        <tr>
          <td class="k">Content</td>
          <td>{sig.contentType}{sig.detached ? ", detached (no content embedded)" : ""}</td>
        </tr>
      {/if}
      <tr>
        <td class="k">Certificates</td>
        <td>
          {sig.certificates.length} embedded
          {#if sig.certificates.length}
            <button class="chip" onclick={() => (showCerts = !showCerts)}>{showCerts ? "hide" : "show"}</button>
          {/if}
        </td>
      </tr>
    </tbody>
  </table>
  {#if showCerts}
    <CertView certs={sig.certificates} signer={sig.signers[0]?.certificate} />
  {/if}
</fieldset>

<style>
  .dn { overflow-wrap: anywhere; }
</style>
