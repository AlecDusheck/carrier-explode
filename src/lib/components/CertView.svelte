<script lang="ts">
  import type { CertInfo } from "$lib/decode";

  let { certs, signer, legend = "Certificate" }: { certs: CertInfo[]; signer?: number; legend?: string } = $props();

  const now = new Date().toISOString();
  const status = (c: CertInfo) => (c.notAfter < now ? "expired" : c.notBefore > now ? "not yet valid" : "valid now");
  const key = (c: CertInfo) =>
    c.keyAlgorithm + (c.keySize ? ", " + c.keySize + "-bit" : "") + (c.curve ? ", " + c.curve : "");
</script>

{#each certs as c, i (i)}
  <fieldset class="hgroup">
    <legend>{legend}{certs.length > 1 ? " " + (i + 1) + " of " + certs.length : ""}{i === signer ? " (signer)" : ""}</legend>
    <table class="grid">
      <tbody>
        <tr><td class="k">Subject</td><td class="dn">{c.subject}</td></tr>
        <tr>
          <td class="k">Issuer</td>
          <td class="dn">{#if c.selfIssued}<span class="chip warn">self-issued</span>{:else}{c.issuer}{/if}</td>
        </tr>
        <tr>
          <td class="k">Validity</td>
          <td>
            {c.notBefore.slice(0, 10)} to {c.notAfter.slice(0, 10)}
            <span class="chip {status(c) === 'valid now' ? 'good' : 'bad'}">{status(c)}</span>
          </td>
        </tr>
        <tr><td class="k">Key</td><td>{key(c)}</td></tr>
        <tr><td class="k">Signature</td><td>{c.signatureAlgorithm}</td></tr>
        {#if c.isCA !== undefined}<tr><td class="k">CA</td><td>{c.isCA ? "yes (may issue certificates)" : "no"}</td></tr>{/if}
        <tr><td class="k">Serial</td><td class="mono wrap">{c.serial}</td></tr>
      </tbody>
    </table>
  </fieldset>
{/each}

<style>
  .dn { overflow-wrap: anywhere; }
</style>
