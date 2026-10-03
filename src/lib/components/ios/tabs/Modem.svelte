<script lang="ts">
  import { page } from "$app/state";
  import { getBundle, getFile } from "#lib/api/bundles.remote.ts";
  import { getBundleOverrides } from "#lib/api/tables.remote.ts";
  import { modemCapabilities } from "#lib/decode/index.ts";
  import { modemHref, rawHref, verArgs, withParams } from "#lib/format.ts";
  import { fileChoices, phoneList, phoneRows, pickPhoneRow } from "#lib/phones.ts";
  import type { TabProps } from "#lib/types.ts";
  import FileBody from "../FileBody.svelte";
  import ModemDefaults from "../ModemDefaults.svelte";
  import PhonePicker from "../../PhonePicker.svelte";

  let { at }: TabProps = $props();

  const args = $derived(verArgs(at));
  const bundle = $derived(await getBundle(args));
  const ov = $derived(await getBundleOverrides(args));
  const rows = $derived(phoneRows(at.version, bundle.info.files, ov));
  const picked = $derived(pickPhoneRow(rows, page.url.searchParams.get("file")));
  const sel = $derived(picked.row);
  const phone = $derived(sel?.phones[0]);
  const caps = $derived(phone?.family ? modemCapabilities(phone.family) : undefined);
</script>

{#if rows.length}
  <PhonePicker platform={at.ref.platform} choices={fileChoices(rows, (file) => withParams(page.url, { file, pri: null, efs: null, base: null }))} selected={sel?.path} />
{:else}
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
    <b class="mono wrap">{sel.path}</b>
    <span class="dimtext">
      {#if phone?.family && ov}
        <a href={modemHref(ov.build, phone.family)}>Modem package</a>{caps?.carrierConfigIn === "bundle" ? "; this file is its whole carrier config" : ""}.
      {:else if sel.phones.length}
        for board {sel.phones.map((p) => p.id).join(", ")}, a phone this site cannot name yet.
      {:else}
        not named for a phone; read alongside each phone's own file where its modem uses this kind of file.
      {/if}
    </span>
  </p>
  <FileBody
    file={await getFile({ ...args, path: sel.path })}
    ctx={{ platform: at.ref.platform, source: at.source, file: sel.path, cc: bundle.cc }}
    raw={rawHref(at, sel.path)}
    devices={false}
  />
  {#if at.ref.kind === "carrier" && phone && caps?.plaintextDefaults}
    <ModemDefaults {at} device={phone.id} phone={phoneList(sel.phones)} />
  {/if}
{/if}
