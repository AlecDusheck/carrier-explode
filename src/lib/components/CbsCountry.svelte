<script lang="ts">
  import { describeMessageId } from "#lib/decode/index.ts";
  import type { CbsRow } from "#lib/types.ts";

  let { row }: { row: CbsRow } = $props();

  const range = (r: { from: number; to: number }) => (r.from === r.to ? String(r.from) : r.from + "-" + r.to);
  const yes = (v?: boolean) => (v === undefined ? "" : v ? "yes" : "no");

  /** The ranges routed to one alert type. */
  const idsFor = (row: CbsRow, type: string) => row.mappings.filter((m) => m.alertType === type).map(range).join(", ");

  function sound(row: CbsRow, configuration?: string) {
    const cfg = row.alertConfigurations.find((c) => c.name === configuration);
    return cfg ? (cfg.sound ?? "") + " / " + (cfg.vibration ?? "") : (configuration ?? "");
  }

  /** Bundle-level settings; empty ones are left out. */
  function settings(row: CbsRow): Array<[string, string]> {
    const dup = [
      row.duplicateWindowMinutes !== undefined ? row.duplicateWindowMinutes + " min window" : "",
      row.interSimDuplicateDetection !== undefined ? "inter-SIM " + yes(row.interSimDuplicateDetection) : "",
      row.intraSimDuplicateDetection !== undefined ? "intra-SIM " + yes(row.intraSimDuplicateDetection) : "",
    ].filter(Boolean).join(", ");
    const rows: Array<[string, string]> = [
      ["Device geofencing", row.geofencing === undefined ? "" : row.geofencing ? "enabled" : "disabled"],
      ["Duplicate suppression", dup],
      ["Emergency numbers", row.emergencyNumbers.join(", ")],
      ["AML SMS destination", row.amlDestination ?? ""],
      ["Alert languages", row.languages.join(", ")],
      ["CBMessage localisations", row.cbMessageLocales.join(" ")],
      ["Alert sound / vibration", [...new Set(row.mappings.map((m) => sound(row, m.configuration)).filter(Boolean))].join(", ")],
      ["ISO codes", row.iso.join(", ")],
      ["Country IDs", row.countryIds.join(", ")],
    ];
    return rows.filter(([, v]) => v);
  }

  const rest = $derived(settings(row));
  const types = $derived(row.alertTypes);
  const muted = $derived(types.some((a) => a.soundAlertDeviceInMute !== undefined));
  const dnd = $derived(types.some((a) => a.soundIsMutableInDND !== undefined));
</script>

{#if row.error}<div class="banner err">{row.error}</div>{/if}

{#if row.mappings.length}
  <fieldset class="hgroup">
    <legend>Alerts ({types.length})</legend>
    {#if row.switchGroupTitle}
      <p class="dimtext note">Listed in Settings under <b>{row.switchGroupTitle}</b>.</p>
    {/if}
    <div class="hscroll">
      <table class="grid">
        <thead>
          <tr>
            <th>Switch</th><th>User can turn off</th><th>On by default</th><th>Message IDs</th>
            {#if muted}<th>Sounds when muted</th>{/if}
            {#if dnd}<th>Muted by Do Not Disturb</th>{/if}
            <th>Notification title</th>
          </tr>
        </thead>
        <tbody>
          {#each types as a (a.name)}
            <tr>
              <td class="k" title={a.name}>{a.switchName || a.name}</td>
              <td>{#if a.userConfigurable === false}<span class="chip bad">no off switch</span>{:else}{yes(a.userConfigurable)}{/if}</td>
              <td>{yes(a.enabledByDefault)}</td>
              <td class="mono">{idsFor(row, a.name)}</td>
              {#if muted}<td>{yes(a.soundAlertDeviceInMute)}</td>{/if}
              {#if dnd}<td>{yes(a.soundIsMutableInDND)}</td>{/if}
              <td>{a.notificationTitle ?? ""}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </fieldset>

  <fieldset class="hgroup">
    <legend>Message IDs ({row.mappings.length})</legend>
    <table class="grid">
      <thead><tr><th>Range</th><th>Alert type</th><th>3GPP TS 23.041</th></tr></thead>
      <tbody>
        {#each row.mappings as m, i (i)}
          <tr>
            <td class="mono num">{range(m)}</td>
            <td class="k">{m.alertType ?? ""}</td>
            <td class="dimtext">{describeMessageId(m.from) ?? ""}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if row.appleSafetyAlertRanges.length}
      <p class="dimtext note">Apple safety alerts: <span class="mono">{row.appleSafetyAlertRanges.map(range).join(", ")}</span></p>
    {/if}
  </fieldset>
{:else}
  <p class="dimtext note">This bundle configures no cell broadcast alerts.</p>
{/if}

{#if rest.length}
  <fieldset class="hgroup">
    <legend>Other alert settings</legend>
    <table class="grid fit">
      <tbody>
        {#each rest as [k, v] (k)}<tr><td class="k">{k}</td><td class="mono wrap">{v}</td></tr>{/each}
      </tbody>
    </table>
  </fieldset>
{/if}
