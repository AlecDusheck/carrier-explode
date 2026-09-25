<script lang="ts">
  import type { DmuKey } from "$lib/decode";

  let { dmu: k }: { dmu: DmuKey } = $props();
</script>

<fieldset class="hgroup">
  <legend>DMU public key</legend>
  <p class="dimtext note">
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
      <tr><td class="k">Modulus</td><td class="mono wrap">{k.modulusBits} bits<div class="dimtext modulus">{k.modulus}</div></td></tr>
    </tbody>
  </table>
</fieldset>

<style>
  .modulus { font-size: 10px; }
</style>
