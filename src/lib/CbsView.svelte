<script lang="ts">
  import { api, type CbsPayload, type CbsRow } from "./api.ts";
  import { describeMessageId } from "../../shared/knowledge.ts";
  import { router } from "./state.svelte.ts";

  let data = $state<CbsPayload | null>(null);
  let error = $state<string | null>(null);
  let mode = $state<"operator" | "matrix" | "detail">("operator");
  let detail = $state<string>("");

  $effect(() => {
    api.cbs("iPhone").then((d) => (data = d)).catch((e) => (error = String(e.message ?? e)));
  });

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
      Downloading and decoding every published country bundle. The first run does the real work; the
      result is then cached at the edge for a week.
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
    <div class="banner">{data.note}</div>

    {#if mode === "operator"}
      <p class="lead">
        Message identifier 4382 is the 3GPP operator-defined CMAS identifier. A country whose bundle maps
        it lets an operator put its own content into the emergency-alert surface; a country that does not
        map it has the handset ignore those broadcasts entirely. Where it is mapped, UserConfigurable
        decides whether the subscriber can switch it off.
      </p>
      <p class="lead">
        <b>
          {#if mapping4382.length === 0}
            None of the {configured.length} published country bundles maps 4382.
          {:else}
            {mapping4382.length} of {configured.length} published country bundles map 4382:
            {mapping4382.map((r) => r.countryName ?? r.country).join(", ")}.
          {/if}
        </b>
        That is only what Apple publishes on the CDN. Countries whose bundle ships inside the iOS system
        image, India among them, cannot be checked from here.
      </p>
      <table class="grid">
        <thead>
          <tr>
            <th class="sticky-col">Country</th><th>4382</th><th>Alert type</th>
            <th>User can disable</th><th>Settings section</th><th class="num">Bundle</th>
          </tr>
        </thead>
        <tbody>
          {#each configured as r (r.key)}
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
            </tr>
          {/each}
        </tbody>
      </table>

      {#if bare.length}
        <fieldset class="hgroup">
          <legend>Published, but with no CellBroadcast block ({bare.length})</legend>
          <p class="dimtext" style="margin-top:0">
            These country bundles exist and carry emergency numbers and IMS settings, but no cell-broadcast
            schema at all, so the handset falls back to whatever the system image provides.
          </p>
          <div>
            {#each bare as r (r.key)}
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
            {#each configured as r (r.key)}
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
      <p class="dimtext">
        Every 3GPP message identifier any published bundle maps, against every country. Blank means the
        identifier is unmapped and the handset ignores it. A marked cell is an alert the user cannot
        switch off.
      </p>
      <table class="grid">
        <thead>
          <tr>
            <th class="sticky-col num">ID</th>
            <th style="min-width:190px">3GPP TS 23.041</th>
            {#each configured as r (r.key)}
              <th title={r.countryName ?? r.country} style="writing-mode:vertical-rl; padding:6px 2px">{r.country}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each ids as id (id)}
            <tr>
              <td class="sticky-col k num">{id}</td>
              <td class="dimtext">{describeMessageId(id) ?? ""}</td>
              {#each configured as r (r.key)}
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
            {#each rows as r (r.key)}<option value={r.country}>{r.countryName ?? r.country}{r.mappings.length ? "" : " (no CellBroadcast)"}</option>{/each}
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
              <tr><td class="k">Bundle</td><td class="mono">{detailRow.key} version {detailRow.version}{detailRow.minOS ? ", min iOS " + detailRow.minOS : ""}</td></tr>
              <tr><td class="k">ISO codes</td><td>{#each detailRow.iso as i (i)}<span class="chip">{i}</span>{/each}</td></tr>
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
