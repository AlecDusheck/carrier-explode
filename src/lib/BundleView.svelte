<script lang="ts">
  import { api, humanBytes, type BundlePayload, type DecodedFile } from "./api.ts";
  import Tree from "./Tree.svelte";
  import FileBody from "./FileBody.svelte";

  let { bundle, cc, kind }: { bundle: BundlePayload; cc?: string; kind: "carrier" | "country" } = $props();

  type Tab = "summary" | "carrier" | "pri" | "files" | "strings" | "assets";
  let tab = $state<Tab>("summary");

  // Binary overrides first: they are the reason this tab exists.
  const priFiles = $derived(
    bundle.info.files
      .filter((f) => f.kind === "pri-der" || f.kind === "pri-plain")
      .sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === "pri-der" ? -1 : 1)),
  );
  const l10nFiles = $derived(bundle.info.files.filter((f) => !!f.locale));
  const imageFiles = $derived(bundle.info.files.filter((f) => f.kind === "image"));

  let priPath = $state<string | null>(null);
  let filePath = $state<string | null>(null);
  let locale = $state<string | null>(null);
  let stringsPath = $state<string | null>(null);

  $effect(() => {
    // Reset per bundle.
    void bundle.url;
    tab = "summary";
    filePath = null;
    priPath = priFiles[0]?.path ?? null;
    locale = bundle.info.locales.includes("en") ? "en" : (bundle.info.locales[0] ?? null);
  });

  const localeFiles = $derived(l10nFiles.filter((f) => f.locale === locale));
  $effect(() => {
    stringsPath = localeFiles[0]?.path ?? null;
  });


  let fileData = $state<(DecodedFile & { dataUri?: string }) | null>(null);
  let fileError = $state<string | null>(null);
  let fileBusy = $state(false);
  let fileToken = 0;

  function load(path: string | null) {
    const mine = ++fileToken;
    fileData = null;
    fileError = null;
    if (!path) return;
    fileBusy = true;
    api.file(bundle.url, path)
      .then((d) => { if (mine === fileToken) fileData = d; })
      .catch((e) => { if (mine === fileToken) fileError = String(e.message ?? e); })
      .finally(() => { if (mine === fileToken) fileBusy = false; });
  }

  const activePath = $derived(
    tab === "pri" ? priPath : tab === "files" ? filePath : tab === "strings" ? stringsPath : null,
  );
  $effect(() => { load(activePath); });

  const carrierPlist = $derived(bundle.quick["carrier.plist"] as Record<string, unknown> | undefined);
  const infoPlist = $derived(bundle.quick["Info.plist"] as Record<string, unknown> | undefined);
  const versionPlist = $derived(bundle.quick["version.plist"] as Record<string, unknown> | undefined);

  const HIGHLIGHTS: Array<[string, string[]]> = [
    ["Identity", ["CarrierName", "HomeBundleIdentifier", "CountryName", "ISOAlpha2CountryCode", "SupportedSIMs", "SupportedPLMNs", "SupportedCarrierIds", "SupportedCountryIds", "MVNOOverrides"]],
    ["Data", ["apns", "AttachAPN", "MTU", "MMS", "DataIndicatorOverrideForLTE", "DataIndicatorOverrideForNRMmwave", "PcoOptions", "APNEditabilityTypemask", "APNEditabilityTypemaskNew"]],
    ["Entitlements and eSIM", ["CarrierEntitlements", "RemoteCardProvisioningSettings", "PhoneAccountTransfer", "CellularPlanProvisioningSettings", "OTAActivation", "EncryptedIdentity", "QuickSwitch"]],
    ["Voice and IMS", ["IMSConfig", "TechSettings", "RCS", "VoicemailPilotNumber", "PhoneNumberRegistrationGatewayAddress", "SMSSettings", "PushSettings", "VisualVoicemailServiceName"]],
    ["Emergency and alerts", ["CellBroadcast", "EmergencyCalling", "EmergencyNumbers", "e_only_whitelist", "TestEmergencyNumber", "Location", "SUPL", "DisallowedDialingPrefixes"]],
    ["Presentation and policy", ["StatusBarImages", "Services", "CarrierBookmarks", "MyAccountURL", "CarrierSpace", "ManagedHours", "OTASoftwareUpdate", "NetworkEncryptionCiphers", "AllowedServicesTypeMaskOnInternet", "IgnoresDeactivateOnNetworkScanServiceMask"]],
  ];

  const groups = $derived.by(() => {
    if (!carrierPlist) return [];
    const out: Array<[string, Record<string, unknown>]> = [];
    for (const [title, keys] of HIGHLIGHTS) {
      const picked: Record<string, unknown> = {};
      for (const k of keys) if (k in carrierPlist) picked[k] = carrierPlist[k];
      if (Object.keys(picked).length) out.push([title, picked]);
    }
    return out;
  });

  const restKeys = $derived.by(() => {
    if (!carrierPlist) return {} as Record<string, unknown>;
    const used = new Set(HIGHLIGHTS.flatMap(([, ks]) => ks));
    return Object.fromEntries(Object.entries(carrierPlist).filter(([k]) => !used.has(k)));
  });

  const ctx = $derived({ file: "carrier.plist", cc, kind });
</script>

<div class="tabs">
  <button aria-current={tab === "summary"} onclick={() => (tab = "summary")}>Summary</button>
  {#if carrierPlist}
    <button aria-current={tab === "carrier"} onclick={() => (tab = "carrier")}>carrier.plist</button>
  {/if}
  {#if priFiles.length}
    <button aria-current={tab === "pri"} onclick={() => (tab = "pri")}>Baseband ({priFiles.length})</button>
  {/if}
  <button aria-current={tab === "files"} onclick={() => (tab = "files")}>Files ({bundle.info.files.length})</button>
  {#if imageFiles.length}
    <button aria-current={tab === "assets"} onclick={() => (tab = "assets")}>Assets ({imageFiles.length})</button>
  {/if}
  {#if l10nFiles.length}
    <button aria-current={tab === "strings"} onclick={() => (tab = "strings")}>Strings ({bundle.info.locales.length})</button>
  {/if}
</div>

<div class="scroll pad">
  {#if tab === "summary"}
    <fieldset class="hgroup">
      <legend>Package</legend>
      <table class="grid">
        <tbody>
          <tr><td class="k">Bundle</td><td class="mono">{bundle.info.bundleName}</td></tr>
          <tr><td class="k">Build</td><td class="mono">{bundle.ref?.build ?? String(infoPlist?.CFBundleVersion ?? "")}</td></tr>
          {#if versionPlist}
            <tr>
              <td class="k">version.plist</td>
              <td class="mono">{Object.entries(versionPlist).map(([k, v]) => k + "=" + String(v)).join("  ")}</td>
            </tr>
          {/if}
          <tr>
            <td class="k">iOS key</td>
            <td class="mono">{bundle.ref?.os ?? ""}{bundle.ref?.productType ? ", " + bundle.ref.productType : ""}</td>
          </tr>
          <tr>
            <td class="k">Size</td>
            <td>{humanBytes(bundle.downloadSize)} packed, {humanBytes(bundle.info.totalSize)} unpacked, {bundle.info.files.length} files</td>
          </tr>
          <tr>
            <td class="k">SHA-1</td>
            <td class="mono wrap">
              {bundle.sha1}
              {#if bundle.digestMatch}
                <span class="chip {bundle.digestMatch.sha1 ? 'good' : 'bad'}">
                  {bundle.digestMatch.sha1 ? "matches manifest Digest" : "does not match manifest Digest"}
                </span>
              {/if}
            </td>
          </tr>
          <tr>
            <td class="k">SHA-384</td>
            <td class="mono wrap">
              {bundle.sha384}
              {#if bundle.digestMatch?.sha384 !== undefined}
                <span class="chip {bundle.digestMatch.sha384 ? 'good' : 'bad'}">
                  {bundle.digestMatch.sha384 ? "matches Digest3" : "does not match Digest3"}
                </span>
              {/if}
            </td>
          </tr>
          <tr><td class="k">Source</td><td class="mono wrap"><a href={bundle.url} rel="noreferrer">{bundle.url}</a></td></tr>
          {#if bundle.info.deviceStems.length}
            <tr><td class="k">Override sets</td><td>{bundle.info.deviceStems.length}</td></tr>
          {/if}
          {#if bundle.info.locales.length}
            <tr><td class="k">Localisations</td><td class="mono wrap">{bundle.info.locales.join(" ")}</td></tr>
          {/if}
        </tbody>
      </table>
      <div class="rowflex" style="margin-top:8px">
        <a class="btn" href={api.downloadUrl(bundle.url)}>Download .ipcc</a>
      </div>
    </fieldset>

    {#if !carrierPlist}
      <div class="banner">This bundle has no carrier.plist.</div>
    {/if}

    {#each groups as [title, picked] (title)}
      <fieldset class="hgroup">
        <legend>{title}</legend>
        <Tree value={picked} {ctx} />
      </fieldset>
    {/each}

    {#if Object.keys(restKeys).length}
      <fieldset class="hgroup">
        <legend>Other carrier.plist keys ({Object.keys(restKeys).length})</legend>
        <Tree value={restKeys} {ctx} />
      </fieldset>
    {/if}

  {:else if tab === "carrier"}
    <Tree value={carrierPlist} {ctx} />

  {:else if tab === "pri"}
    <div class="rowflex" style="margin-bottom:8px">
      <label class="lbl grow">
        File
        <select class="grow" bind:value={priPath}>
          {#each priFiles as f (f.path)}
            <option value={f.path}>
              {f.path}{f.devices?.length ? " - " + f.devices.map((d) => d.name ?? d.code).join(", ") : ""}
            </option>
          {/each}
        </select>
      </label>
    </div>
    {#if fileBusy}<p class="dimtext">Decoding.</p>{/if}
    {#if fileError}<div class="banner err">{fileError}</div>{/if}
    {#if fileData}<FileBody file={fileData} {ctx} bundleUrl={bundle.url} />{/if}

  {:else if tab === "files"}
    <div class="rowflex" style="margin-bottom:6px">
      <label class="lbl grow">
        File
        <select class="grow" bind:value={filePath}>
          <option value={null}>all files</option>
          {#each bundle.info.files as f (f.path)}
            <option value={f.path}>{f.path} ({humanBytes(f.size)})</option>
          {/each}
        </select>
      </label>
    </div>
    {#if !filePath}
      <table class="grid">
        <thead><tr><th>Path</th><th>Kind</th><th class="num">Size</th><th>Devices</th></tr></thead>
        <tbody>
          {#each bundle.info.files as f (f.path)}
            <tr style="cursor:pointer" onclick={() => (filePath = f.path)}>
              <td class="mono wrap">{f.path}</td>
              <td>{f.kind}</td>
              <td class="num">{humanBytes(f.size)}</td>
              <td class="dimtext">{f.devices?.map((d) => d.name ?? d.code).join(", ") ?? ""}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    {#if fileBusy}<p class="dimtext">Decoding.</p>{/if}
    {#if fileError}<div class="banner err">{fileError}</div>{/if}
    {#if fileData}
      <h3 class="mono" style="margin:8px 0 4px">{fileData.path}</h3>
      <FileBody file={fileData} {ctx} bundleUrl={bundle.url} />
    {/if}

  {:else if tab === "assets"}
    <p class="lead dimtext" style="margin-top:0">
      Status-bar carrier logos, drawn in place of the operator name. Older bundles ship them at several
      sizes: Default for the lock screen and status bar, FSO for the field-service display, TS for the
      tethering banner.
    </p>
    <div style="display:flex; flex-wrap:wrap; gap:8px">
      {#each imageFiles as f (f.path)}
        <figure
          style="margin:0; border:1px solid var(--shadow); background:var(--face); padding:6px; min-width:130px; text-align:center"
        >
          <span class="checker" style="display:inline-block; padding:6px">
            <img src={api.rawUrl(bundle.url, f.path)} alt={f.path} style="max-width:200px; image-rendering:pixelated; display:block" />
          </span>
          <figcaption class="mono" style="font-size:10px; word-break:break-all; margin-top:4px">
            {f.path}<br /><span class="dimtext">{humanBytes(f.size)}</span>
          </figcaption>
        </figure>
      {/each}
    </div>

  {:else if tab === "strings"}
    <div class="rowflex" style="margin-bottom:8px">
      <label class="lbl">
        Locale
        <select bind:value={locale}>
          {#each bundle.info.locales as l (l)}<option value={l}>{l}</option>{/each}
        </select>
      </label>
      <label class="lbl grow">
        File
        <select class="grow" bind:value={stringsPath}>
          {#each localeFiles as f (f.path)}<option value={f.path}>{f.path.split("/").pop()}</option>{/each}
        </select>
      </label>
    </div>
    {#if fileBusy}<p class="dimtext">Decoding.</p>{/if}
    {#if fileError}<div class="banner err">{fileError}</div>{/if}
    {#if fileData}<FileBody file={fileData} {ctx} bundleUrl={bundle.url} />{/if}
  {/if}
</div>
