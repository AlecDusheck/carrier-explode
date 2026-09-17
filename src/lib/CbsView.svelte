<script lang="ts">
  import { api, type CbsRow } from "./api.ts";
  import { describeMessageId } from "../../shared/knowledge.ts";
  import { router, resource } from "./state.svelte.ts";

  const table = resource(() => api.cbs());
  const data = $derived(table.value);
  const error = $derived(table.error);
  let mode = $state<"operator" | "matrix" | "detail">("operator");
  let detail = $state<string>("");

  const rows = $derived(data?.rows ?? []);
  const configured = $derived(rows.filter((r) => r.mappings.length > 0));
  const bare = $derived(rows.filter((r) => r.mappings.length === 0 && !r.error));
  const mapping4382 = $derived(configured.filter((r) => r.maps4382));
  const ids = $derived(data?.messageIds ?? []);
  const detailRow = $derived(rows.find((r) => r.country === detail));

  function alertFor(row: CbsRow, id: number) {
    const m = row.mappings.find((x) => id >= x.from && id <= x.to);
    if (!m?.alertType) return { type: undefined as string | undefined, configurable: undefined as boolean | null | undefined };
    const at = row.alertTypes.find((a) => a.name === m.alertType);
    return { type: m.alertType, configurable: at?.userConfigurable ?? null };
  }

  const shortType = (t?: string) => (t ? t.replace(/Alert$/, "").replace(/([a-z])([A-Z])/g, "$1 $2") : "");

  function open(row: CbsRow) {
    detail = row.country;
    mode = "detail";
  }
</script>

{#if error}
  <div class="scroll pad"><div class="banner err">{error}</div></div>
{:else if !data}
  <div class="scroll pad">
    <p class="dimtext">
      Building the table.
    </p>
  </div>
{:else}
  <div class="toolbar">
    <button class="btn" class:on={mode === "operator"} onclick={() => (mode = "operator")}>Operator-defined 4382</button>
    <button class="btn" class:on={mode === "matrix"} onclick={() => (mode = "matrix")}>Full ID matrix</button>
    <button class="btn" class:on={mode === "detail"} onclick={() => (mode = "detail")}>Per-country detail</button>
    <span class="grow"></span>
    <span class="dimtext">{configured.length} of {rows.length} bundles carry alert configuration</span>
  </div>

  <div class="scroll pad">
    {#if data.image}
      <p class="dimtext" style="margin-top:0">
        From the iOS {data.image.version} image ({data.image.build}). Rows marked asset server have a newer
        bundle there.
      </p>
    {/if}

    {#if mode === "operator"}
      <p class="lead">
        4382 is the operator-defined CMAS message ID. A bundle that maps it lets the operator put its own
        content in the emergency-alert surface; unmapped IDs are ignored by the phone.
        <b>
          {#if mapping4382.length === 0}
            None of the {configured.length} bundles map it.
          {:else}
            {mapping4382.length} of {configured.length} map it:
            {mapping4382.map((r) => r.countryName ?? r.country).join(", ")}.
          {/if}
        </b>
      </p>
      <table class="grid">
        <thead>
          <tr>
            <th class="sticky-col">Country</th><th>4382</th><th>Alert type</th>
            <th>User can disable</th><th>Settings section</th><th class="num">Bundle</th><th>Source</th>
          </tr>
        </thead>
        <tbody>
          {#each configured as r (r.country)}
            <tr style="cursor:pointer" onclick={() => open(r)}>
              <td class="sticky-col k">{r.countryName ?? r.country}</td>
              <td>
                {#if r.maps4382}<span class="chip warn">mapped</span>{:else}<span class="chip good">not mapped</span>{/if}
              </td>
              <td>{shortType(r.alertType4382)}</td>
              <td>
                {#if !r.maps4382}<span class="dimtext">n/a</span>
                {:else if r.configurable4382 === false}<span class="chip bad">no off switch</span>
                {:else if r.configurable4382 === true}<span class="chip good">yes</span>
                {:else}<span class="dimtext">unstated</span>{/if}
              </td>
              <td>{r.switchGroupTitle ?? ""}</td>
              <td class="num mono">{r.version}</td>
              <td class="dimtext">{r.source === "image" ? "image" : "asset server"}</td>
            </tr>
          {/each}
        </tbody>
      </table>

      {#if bare.length}
        <fieldset class="hgroup">
          <legend>No CellBroadcast block ({bare.length})</legend>
          <div>
            {#each bare as r (r.country)}
              <button class="chip" onclick={() => router.go("countries", r.country)}>{r.countryName ?? r.country}</button>
            {/each}
          </div>
        </fieldset>
      {/if}

      <fieldset class="hgroup">
        <legend>Alert types with no off switch</legend>
        <table class="grid">
          <thead><tr><th class="sticky-col">Country</th><th>Non-configurable alert types</th></tr></thead>
          <tbody>
            {#each configured as r (r.country)}
              <tr>
                <td class="sticky-col k">{r.countryName ?? r.country}</td>
                <td>
                  {#each r.alertTypes.filter((a) => a.userConfigurable === false) as a (a.name)}
                    <span class="chip bad">{a.name}</span>
                  {:else}
                    <span class="dimtext">every alert type can be switched off</span>
                  {/each}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </fieldset>

    {:else if mode === "matrix"}
      <p class="dimtext">Blank means unmapped, so the phone ignores it. Locked means no off switch.</p>
      <table class="grid">
        <thead>
          <tr>
            <th class="sticky-col num">ID</th>
            <th style="min-width:190px">3GPP TS 23.041</th>
            {#each configured as r (r.country)}
              <th title={r.countryName ?? r.country} style="writing-mode:vertical-rl; padding:6px 2px">{r.country}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each ids as id (id)}
            <tr>
              <td class="sticky-col k num">{id}</td>
              <td class="dimtext">{describeMessageId(id) ?? ""}</td>
              {#each configured as r (r.country)}
                {@const a = alertFor(r, id)}
                <td style="white-space:nowrap; font-size:10px">
                  {#if a.type}{shortType(a.type)}{#if a.configurable === false}<span class="chip bad">locked</span>{/if}{/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>

    {:else}
      <div class="rowflex" style="margin-bottom:8px">
        <label class="lbl grow">
          Country
          <select class="grow" bind:value={detail}>
            <option value="">pick a country</option>
            {#each rows as r (r.country)}<option value={r.country}>{r.countryName ?? r.country}{r.mappings.length ? "" : " (no CellBroadcast)"}</option>{/each}
          </select>
        </label>
        {#if detailRow}
          <button class="btn" onclick={() => router.go("countries", detailRow.country)}>Open bundle</button>
        {/if}
      </div>

      {#if detailRow}
        {#if detailRow.error}<div class="banner err">{detailRow.error}</div>{/if}
        <fieldset class="hgroup">
          <legend>{detailRow.countryName ?? detailRow.country}</legend>
          <table class="grid">
            <tbody>
              <tr><td class="k">Bundle</td><td class="mono">{detailRow.key} build {detailRow.version}, {detailRow.source === "image" && data.image ? "iOS " + data.image.version + " image" : "asset server"}{detailRow.minOS ? ", iOS " + detailRow.minOS + "+" : ""}</td></tr>
              <tr><td class="k">ISO codes</td><td>{#each detailRow.iso as code, i (i)}<span class="chip">{code}</span>{/each}</td></tr>
              <tr><td class="k">Country IDs routed here</td><td class="mono wrap">{detailRow.countryIds.join(", ")}</td></tr>
              <tr><td class="k">Settings section</td><td>{detailRow.switchGroupTitle ?? ""}</td></tr>
              <tr><td class="k">Broadcast languages</td><td class="mono">{detailRow.languages.join(", ")}</td></tr>
              <tr>
                <td class="k">Device geofencing</td>
                <td>
                  {#if detailRow.geofencing === undefined}<span class="dimtext">unset</span>
                  {:else if detailRow.geofencing}<span class="chip good">enabled</span>
                  {:else}<span class="chip">disabled</span>{/if}
                </td>
              </tr>
              <tr>
                <td class="k">Duplicate suppression</td>
                <td>
                  {detailRow.duplicateWindowMinutes !== undefined ? detailRow.duplicateWindowMinutes + " min window" : ""}
                  {#if detailRow.interSimDuplicateDetection !== undefined}<span class="chip">inter-SIM {detailRow.interSimDuplicateDetection}</span>{/if}
                  {#if detailRow.intraSimDuplicateDetection !== undefined}<span class="chip">intra-SIM {detailRow.intraSimDuplicateDetection}</span>{/if}
                </td>
              </tr>
              <tr><td class="k">Emergency numbers</td><td class="mono">{detailRow.emergencyNumbers.join(", ")}</td></tr>
              <tr><td class="k">AML SMS destination</td><td class="mono">{detailRow.amlDestination ?? ""}</td></tr>
              <tr><td class="k">CBMessage localisations</td><td class="mono wrap">{detailRow.cbMessageLocales.join(" ")}</td></tr>
            </tbody>
          </table>
        </fieldset>

        <fieldset class="hgroup">
          <legend>Message ID mappings</legend>
          <table class="grid">
            <thead><tr><th>Range</th><th>Alert type</th><th>Sound / vibration</th><th>3GPP TS 23.041</th></tr></thead>
            <tbody>
              {#each detailRow.mappings as m, i (i)}
                {@const cfg = detailRow.alertConfigurations.find((c) => c.name === m.configuration)}
                <tr>
                  <td class="mono num">{m.from === m.to ? m.from : m.from + "-" + m.to}</td>
                  <td class="k">{m.alertType ?? ""}</td>
                  <td class="mono">{cfg ? (cfg.sound ?? "") + " / " + (cfg.vibration ?? "") : (m.configuration ?? "")}</td>
                  <td class="dimtext">{describeMessageId(m.from) ?? ""}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if detailRow.appleSafetyAlertRanges.length}
            <p class="dimtext" style="margin-bottom:0">
              Also fed into Apple's own safety-alert surface:
              {#each detailRow.appleSafetyAlertRanges as r, i (i)}
                <span class="chip">{r.from === r.to ? r.from : r.from + "-" + r.to}</span>
              {/each}
            </p>
          {/if}
        </fieldset>

        <fieldset class="hgroup">
          <legend>Alert types</legend>
          <table class="grid">
            <thead>
              <tr>
                <th>Type</th><th>Switch name</th><th>Notification title</th>
                <th>Default on</th><th>User configurable</th><th>Sounds when muted</th><th>Mutable in DND</th>
              </tr>
            </thead>
            <tbody>
              {#each detailRow.alertTypes as a (a.name)}
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
        </fieldset>
      {/if}
    {/if}
  </div>
{/if}
