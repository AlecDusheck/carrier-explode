<script lang="ts">
  import type { getBundle } from "$lib/api/bundles.remote";
  import { isJsonDict } from "$lib/decode";
  import { bundleHref, entryLabel, humanBytes } from "$lib/format";
  import Tree from "./Tree.svelte";

  let { bundle }: { bundle: Awaited<ReturnType<typeof getBundle>> } = $props();

  const dict = (v: unknown) => (isJsonDict(v) ? v : undefined);
  const carrierPlist = $derived(dict(bundle.quick["carrier.plist"]));
  const infoPlist = $derived(dict(bundle.quick["Info.plist"]));
  const versionPlist = $derived(dict(bundle.quick["version.plist"]));

  const HIGHLIGHTS: Array<[string, string[]]> = [
    ["Identity", ["CarrierName", "HomeBundleIdentifier", "CountryName", "ISOAlpha2CountryCode", "SupportedSIMs", "SupportedPLMNs", "SupportedCarrierIds", "SupportedCountryIds", "MVNOOverrides"]],
    ["Data", ["apns", "AttachAPN", "MTU", "MMS", "DataIndicatorOverrideForLTE", "DataIndicatorOverrideForNRMmwave", "PcoOptions", "APNEditabilityTypemask", "APNEditabilityTypemaskNew"]],
    ["Entitlements and eSIM", ["CarrierEntitlements", "RemoteCardProvisioningSettings", "PhoneAccountTransfer", "CellularPlanProvisioningSettings", "OTAActivation", "EncryptedIdentity", "QuickSwitch"]],
    ["Voice and IMS", ["IMSConfig", "TechSettings", "RCS", "VoicemailPilotNumber", "PhoneNumberRegistrationGatewayAddress", "SMSSettings", "PushSettings", "VisualVoicemailServiceName"]],
    ["Emergency and alerts", ["CellBroadcast", "EmergencyCalling", "EmergencyNumbers", "e_only_whitelist", "TestEmergencyNumber", "Location", "SUPL", "DisallowedDialingPrefixes"]],
    ["Presentation and policy", ["StatusBarImages", "Services", "CarrierBookmarks", "MyAccountURL", "CarrierSpace", "ManagedHours", "OTASoftwareUpdate", "NetworkEncryptionCiphers", "AllowedServicesTypeMaskOnInternet", "IgnoresDeactivateOnNetworkScanServiceMask"]],
  ];
  const USED = new Set(HIGHLIGHTS.flatMap(([, keys]) => keys));

  const groups = $derived.by(() => {
    const out: Array<[string, Record<string, unknown>]> = [];
    if (!carrierPlist) return out;
    for (const [title, keys] of HIGHLIGHTS) {
      const picked = Object.fromEntries(keys.filter((k) => k in carrierPlist).map((k) => [k, carrierPlist[k]]));
      if (Object.keys(picked).length) out.push([title, picked]);
    }
    const rest = Object.fromEntries(Object.entries(carrierPlist).filter(([k]) => !USED.has(k)));
    const n = Object.keys(rest).length;
    if (n) out.push([`Other keys (${n})`, rest]);
    return out;
  });

  const fromImage = $derived(bundle.entry.source === "image");
  const ctx = $derived({ file: "carrier.plist", cc: bundle.cc });
</script>

<fieldset class="hgroup">
  <legend>Package</legend>
  <table class="grid">
    <tbody>
      <!-- Name and build are in the header and the From row; these rows only appear when they say something else. -->
      {#if bundle.info.bundleName !== bundle.name}
        <tr><td class="k">Bundle</td><td class="mono">{bundle.info.bundleName}</td></tr>
      {/if}
      {#if !bundle.entry.build && infoPlist?.CFBundleVersion !== undefined}
        <tr><td class="k">Build</td><td class="mono">{String(infoPlist.CFBundleVersion)}</td></tr>
      {/if}
      <tr>
        <td class="k">From</td>
        <td>
          {entryLabel(bundle.entry)}
          {#if bundle.verified === true}<span class="chip good" title="{fromImage ? 'Content ID' : 'SHA-1'} matches the published digest">verified</span>
          {:else if bundle.verified === false}<span class="chip bad">digest mismatch</span>{/if}
          {#if bundle.previous}
            &middot; <a href={bundleHref(bundle.kind, bundle.name, bundle.entry.slug, "changes")}>Changes since build {bundle.previous.build}</a>
          {/if}
        </td>
      </tr>
    </tbody>
  </table>
  <details class="more">
    <summary>Digests, size and source</summary>
    <table class="grid">
      <tbody>
        <tr>
          <td class="k">Size</td>
          <td>{humanBytes(bundle.downloadSize)} packed, {humanBytes(bundle.info.totalSize)} unpacked, {bundle.info.files.length} files</td>
        </tr>
        <tr><td class="k">Content ID</td><td class="mono wrap">{bundle.contentId}</td></tr>
        <tr><td class="k">SHA-1</td><td class="mono wrap">{bundle.sha1}</td></tr>
        <tr><td class="k">SHA-384</td><td class="mono wrap">{bundle.sha384}</td></tr>
        {#if bundle.entry.url}
          <tr><td class="k">URL</td><td class="mono wrap"><a href={bundle.entry.url} rel="noreferrer">{bundle.entry.url}</a></td></tr>
        {/if}
        {#if versionPlist}
          <tr>
            <td class="k">version.plist</td>
            <td class="mono wrap">{Object.entries(versionPlist).map(([k, v]) => k + "=" + String(v)).join("  ")}</td>
          </tr>
        {/if}
        {#if bundle.info.locales.length}
          <tr><td class="k">Localisations</td><td class="mono wrap">{bundle.info.locales.join(" ")}</td></tr>
        {/if}
      </tbody>
    </table>
  </details>
  {#if bundle.entry.url}
    <div class="rowflex gap-above">
      <a class="btn" href={bundle.entry.url} rel="noreferrer" download>Download .ipcc</a>
    </div>
  {/if}
</fieldset>

{#if bundle.related.carriers.length}
  <fieldset class="hgroup" id="carriers">
    <legend>Carriers ({bundle.related.carriers.length})</legend>
    {#each bundle.related.carriers as name (name)}
      <a class="chip" href={bundleHref("carriers", name)}>{name}</a>
    {/each}
  </fieldset>
{/if}

{#if !carrierPlist}
  <div class="banner">No carrier.plist.</div>
{/if}

{#each groups as [title, picked] (title)}
  <fieldset class="hgroup">
    <legend>{title}</legend>
    <Tree value={picked} {ctx} />
  </fieldset>
{/each}
