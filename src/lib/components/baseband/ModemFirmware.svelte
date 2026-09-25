<script lang="ts">
  import { getModemPackageHeader } from "$lib/api/tables.remote";
  import type { ModemCapabilities } from "$lib/decode";
  import { fileHref, humanBytes, link } from "$lib/format";
  import { imageSlug } from "$lib/names";
  import type { BasebandBuild, ImageModem } from "./types";

  let { modem, caps, version, others }: {
    modem: ImageModem;
    caps: ModemCapabilities | undefined;
    /** iOS version of the image. */
    version: string;
    /** Other images carrying a package of this family. */
    others: BasebandBuild[];
  } = $props();

  const family = $derived(modem.family);
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
          {#if s.package.build}<tr><td class="k">Build</td><td class="mono wrap">{s.package.build}</td></tr>{/if}
          <tr><td class="k">Entries</td><td>{s.entries.length} in the ftab container</td></tr>
        {:else if s.package.chipId}
          <tr><td class="k">Chip ID</td><td class="mono">{s.package.chipId}</td></tr>
        {/if}
        <tr><td class="k">Package</td><td class="mono wrap">{modem.package.name} <span class="dimtext size">{humanBytes(modem.package.size)}</span></td></tr>
      </tbody>
    </table>
  </div>
  {#if caps?.carrierConfigIn === "bundle"}
    <p class="prose">
      {family} phones carry no carrier config in the modem package. Their carrier settings arrive entirely through the
      carrier bundles' Intel-dialect <span class="mono">.der.pri</span> and <span class="mono">.der.gri</span> files; the regional
      band tables are in Default.bundle's
      <a class="mono" href={fileHref("carriers", "Default", imageSlug(version), "global_setting_G.der.gri")}>global_setting_G.der.gri</a>.
    </p>
  {:else}
    <p class="prose">The {family} package has no plaintext config; its carrier settings come from the bundles' <span class="mono">.der.pri</span> files.</p>
  {/if}
  {#if others.length}
    <div class="rowflex elsewhere">
      <span class="dimtext">{family} in</span>
      {#each others as b (b.build)}<a class="chip" href={link(`/baseband/${b.build}/${family}`)}>iOS {b.version}</a>{/each}
    </div>
  {/if}
</fieldset>

<style>
  .size { white-space: nowrap; }
  .elsewhere { margin-top: 6px; }
  @media (max-width: 760px) {
    .elsewhere .chip { padding: 6px 8px; }
  }
</style>
