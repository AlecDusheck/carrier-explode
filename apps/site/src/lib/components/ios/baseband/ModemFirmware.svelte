<script lang="ts">
  import { getModemPackageHeader } from "#lib/api/apple.remote.ts";
  import type { ModemCapabilities } from "@carrier-explode/decode-ios";
  import { humanBytes, link } from "#lib/format.ts";
  import type { ImageModem } from "./types";

  // Other iOS versions with this modem are one pick away in the page's iOS picker.
  let { modem, caps, defaultBundle }: { modem: ImageModem; caps: ModemCapabilities | undefined; defaultBundle: string | null } = $props();
  const s = $derived(await getModemPackageHeader(modem.package.id));
</script>

<fieldset class="hgroup">
  <legend>Firmware</legend>
  <div class="hscroll">
    <table class="grid fit">
      <tbody>
        {#if s.package.version}<tr><td class="k">Version</td><td class="mono">{s.package.version}</td></tr>{/if}
        {#if s.kind === "ftab"}
          {#if s.package.date}<tr><td class="k">Built</td><td class="mono">{s.package.date}</td></tr>{/if}
          {#if s.package.chip}<tr><td class="k">Chip</td><td class="mono">{s.package.chip}{#if s.package.chipRevision}<span class="dimtext sp">revision {s.package.chipRevision}</span>{/if}</td></tr>{/if}
          {#if s.package.build}<tr><td class="k">Build</td><td class="mono">{s.package.build}</td></tr>{/if}
          <tr><td class="k">Entries</td><td>{s.entries.length}</td></tr>
        {:else if s.package.chipId}
          <tr><td class="k">Chip ID</td><td class="mono">{s.package.chipId}</td></tr>
        {/if}
        <tr><td class="k">Size</td><td>{humanBytes(modem.package.size)}</td></tr>
      </tbody>
    </table>
  </div>
  {#if caps?.carrierConfigIn === "bundle"}
    <p class="prose">
      No carrier config in the package: it all comes from the bundles' <span class="mono">.der.pri</span> and
      <span class="mono">.der.gri</span> files. Regional band tables are in Default.bundle's
      {#if defaultBundle}<a class="mono" href={link(defaultBundle + "/files/global_setting_G.der.gri")}>global_setting_G.der.gri</a>{:else}<span class="mono">global_setting_G.der.gri</span>{/if}.
    </p>
  {:else if !caps?.plaintextDefaults}
    <p class="prose">No plaintext config in the package: carrier settings come from the bundles' <span class="mono">.der.pri</span> files.</p>
  {/if}
</fieldset>
