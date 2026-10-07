<script lang="ts">
  import { page } from "$app/state";
  import { getAppleBundle, getAppleFile, getAppleModemConfig } from "#lib/api/apple.remote.ts";
  import { getBundleOverrides } from "#lib/api/apple.remote.ts";
  import { modemCapabilities } from "@carrier-explode/decode-ios";
  import { modemHref, rawHref, verArgs } from "#lib/format.ts";
  import { phoneList, pickPhoneRow } from "#lib/apple/phones.ts";
  import { APPLE_DOCS } from "#lib/apple/tree-docs.ts";
  import { sourceKey } from "@carrier-explode/schema/types";
  import type { TabProps } from "#lib/types.ts";
  import FileBody from "../FileBody.svelte";
  import ModemDefaults from "../ModemDefaults.svelte";
  import ModemConfigView from "../../modem/ModemConfigView.svelte";
  import { tabPhoneRows } from "../phone-rows.ts";

  let { at }: TabProps = $props();

  const args = $derived(verArgs(at));
  const bundle = $derived(await getAppleBundle(args));
  const ov = $derived(await getBundleOverrides(args));
  const rows = $derived(await tabPhoneRows(at, "modem"));
  const picked = $derived(pickPhoneRow(rows, page.url.searchParams.get("file")));
  const sel = $derived(picked.row);
  const phone = $derived(sel?.phones[0]);
  const caps = $derived(phone?.family ? modemCapabilities(phone.family.code) : undefined);
  const config = $derived(sel ? await getAppleModemConfig({ ...args, path: sel.path }) : null);
</script>

{#if !rows.length}
  <p class="dimtext note">No modem override files: every phone runs its modem's defaults with this bundle.</p>
{/if}
{#if picked.missing}
  <div class="banner">No phone reads <span class="mono">{picked.missing}</span> in this version; showing {sel?.phones.length ? phoneList(sel.phones) : sel?.path} instead.</div>
{/if}
{#if ov?.defaults.length}
  <p class="dimtext note">No modem file for {phoneList(ov.defaults)}: they run the modem's defaults.</p>
{/if}

{#if sel}
  <!-- The file's own sections follow at the top level; its name heads them rather than boxing them. -->
  <p class="note">
    <b class="mono">{sel.path}</b>
    <span class="dimtext">
      {#if phone?.family && ov}
        <a href={modemHref("ios", ov.build, phone.family.code)}>Modem package</a>{caps?.carrierConfigIn === "bundle" ? "; this file is its whole carrier config" : ""}.
      {:else if sel.phones.length}
        for {phoneList(sel.phones)}; the release this version is read against has no modem package for {sel.phones.length > 1 ? "them" : "it"}.
      {:else}
        not named for a phone; read alongside each phone's own file where its modem uses this kind of file.
      {/if}
    </span>
  </p>
  {#if config}
    <ModemConfigView {config} />
  {:else}
    <FileBody
      file={await getAppleFile({ ...args, path: sel.path })}
      ctx={{ platform: at.ref.platform, source: sourceKey(at.ref), file: sel.path, cc: bundle.cc, docs: APPLE_DOCS }}
      raw={rawHref(at, sel.path)}
      devices={false}
    />
  {/if}
  {#if at.ref.kind === "carrier" && phone && caps?.plaintextDefaults}
    <ModemDefaults {at} device={phone.code} phone={phoneList(sel.phones)} />
  {/if}
{/if}
