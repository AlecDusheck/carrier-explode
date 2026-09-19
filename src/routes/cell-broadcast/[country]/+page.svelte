<script lang="ts">
  import { getCbs } from "$lib/api/tables.remote";
  import { describeMessageId } from "$lib/knowledge";
  import { bundleHref, link } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";

  let { params } = $props();

  const range = (r: { from: number; to: number }) => (r.from === r.to ? String(r.from) : r.from + "-" + r.to);
</script>

<div class="view">
  <div class="scroll pad">
    <Pane>
      {@const data = await getCbs()}
      {@const row = data.rows.find((r) => r.country === params.country)}
      <div class="rowflex">
        <a class="btn" href={link("/cell-broadcast")}>Cell Broadcast</a>
        <b>{row?.countryName ?? params.country}</b>
        <span class="grow"></span>
        {#if row}<a class="btn" href={bundleHref("countries", row.country)}>Open bundle</a>{/if}
      </div>

      {#if !row}
        <div class="banner err">No country bundle named {params.country}.</div>
      {:else}
        {#if row.error}<div class="banner err">{row.error}</div>{/if}
        <fieldset class="hgroup">
          <legend>Bundle</legend>
          <table class="grid">
            <tbody>
              <tr>
                <td class="k">From</td>
                <td>
                  {row.source === "image" && data.image ? `iOS ${data.image.version} image` : `OTA${row.minOS ? ` · iOS ${row.minOS}+` : ""}`}
                  &middot; build {row.version}
                </td>
              </tr>
              <tr><td class="k">ISO codes</td><td>{#each row.iso as code, i (i)}<span class="chip">{code}</span>{/each}</td></tr>
              <tr><td class="k">Country IDs</td><td class="mono wrap">{row.countryIds.join(", ")}</td></tr>
              <tr><td class="k">Settings section</td><td>{row.switchGroupTitle ?? ""}</td></tr>
              <tr><td class="k">Languages</td><td class="mono">{row.languages.join(", ")}</td></tr>
              <tr>
                <td class="k">Device geofencing</td>
                <td>
                  {#if row.geofencing === undefined}<span class="dimtext">unset</span>
                  {:else if row.geofencing}<span class="chip good">enabled</span>
                  {:else}<span class="chip">disabled</span>{/if}
                </td>
              </tr>
              <tr>
                <td class="k">Duplicate suppression</td>
                <td>
                  {row.duplicateWindowMinutes !== undefined ? row.duplicateWindowMinutes + " min window" : ""}
                  {#if row.interSimDuplicateDetection !== undefined}<span class="chip">inter-SIM {row.interSimDuplicateDetection}</span>{/if}
                  {#if row.intraSimDuplicateDetection !== undefined}<span class="chip">intra-SIM {row.intraSimDuplicateDetection}</span>{/if}
                </td>
              </tr>
              <tr><td class="k">Emergency numbers</td><td class="mono">{row.emergencyNumbers.join(", ")}</td></tr>
              <tr><td class="k">AML SMS destination</td><td class="mono">{row.amlDestination ?? ""}</td></tr>
              <tr><td class="k">CBMessage localisations</td><td class="mono wrap">{row.cbMessageLocales.join(" ")}</td></tr>
            </tbody>
          </table>
        </fieldset>

        {#if row.mappings.length}
          <fieldset class="hgroup">
            <legend>Message ID mappings</legend>
            <table class="grid">
              <thead><tr><th>Range</th><th>Alert type</th><th>Sound / vibration</th><th>3GPP TS 23.041</th></tr></thead>
              <tbody>
                {#each row.mappings as m, i (i)}
                  {@const cfg = row.alertConfigurations.find((c) => c.name === m.configuration)}
                  <tr>
                    <td class="mono num">{range(m)}</td>
                    <td class="k">{m.alertType ?? ""}</td>
                    <td class="mono">{cfg ? (cfg.sound ?? "") + " / " + (cfg.vibration ?? "") : (m.configuration ?? "")}</td>
                    <td class="dimtext">{describeMessageId(m.from) ?? ""}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            {#if row.appleSafetyAlertRanges.length}
              <p class="dimtext" style="margin-bottom:0">
                Apple safety alerts:
                {#each row.appleSafetyAlertRanges as r, i (i)}<span class="chip">{range(r)}</span>{/each}
              </p>
            {/if}
          </fieldset>

          <fieldset class="hgroup">
            <legend>Alert types</legend>
            <div style="overflow-x:auto">
              <table class="grid">
                <thead>
                  <tr>
                    <th>Type</th><th>Switch name</th><th>Notification title</th>
                    <th>Default on</th><th>User configurable</th><th>Sounds when muted</th><th>Mutable in DND</th>
                  </tr>
                </thead>
                <tbody>
                  {#each row.alertTypes as a (a.name)}
                    <tr>
                      <td class="k">{a.name}</td>
                      <td>{a.switchName ?? ""}</td>
                      <td>{a.notificationTitle ?? ""}</td>
                      <td>{#if a.enabledByDefault !== undefined}<span class="chip {a.enabledByDefault ? 'good' : ''}">{a.enabledByDefault}</span>{/if}</td>
                      <td>{#if a.userConfigurable !== undefined}<span class="chip {a.userConfigurable ? 'good' : 'bad'}">{a.userConfigurable}</span>{/if}</td>
                      <td>{a.soundAlertDeviceInMute ?? ""}</td>
                      <td>{a.soundIsMutableInDND ?? ""}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </fieldset>
        {:else}
          <p class="dimtext">No CellBroadcast block.</p>
        {/if}
      {/if}
    </Pane>
  </div>
</div>
