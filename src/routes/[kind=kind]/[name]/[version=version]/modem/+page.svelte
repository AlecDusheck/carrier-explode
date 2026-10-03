<script lang="ts">
  import { page } from "$app/state";
  import { getBundle, getFile } from "#lib/api/bundles.remote.ts";
  import { getBundleOverrides } from "#lib/api/tables.remote.ts";
  import { modemCapabilities } from "#lib/decode/index.ts";
  import { bundleArgs, link, rawHref } from "#lib/format.ts";
  import { phoneList, phoneRows, pickPhoneRow } from "#lib/phones.ts";
  import Pane from "#lib/components/Pane.svelte";
  import FileBody from "#lib/components/FileBody.svelte";
  import ModemDefaults from "#lib/components/ModemDefaults.svelte";
  import PhonePicker from "#lib/components/PhonePicker.svelte";

  let { params } = $props();

  const args = $derived(bundleArgs(params));
  const sp = $derived(page.url.searchParams);
</script>

<div class="scroll pad">
  <Pane>
    {@const bundle = await getBundle(args)}
    {@const ov = await getBundleOverrides(args)}
    {@const rows = phoneRows(bundle.entry, bundle.info.files, ov)}
    {@const { row: sel, missing } = pickPhoneRow(rows, { file: sp.get("file") })}

    {#if rows.length}
      <PhonePicker {rows} selected={sel} />
    {:else}
      <p class="dimtext note">No modem override files: every phone runs its modem's defaults with this bundle.</p>
    {/if}
    {#if missing}
      <div class="banner">No phone reads <span class="mono">{missing}</span> in this version; showing {sel?.phones.length ? phoneList(sel.phones) : sel?.path} instead.</div>
    {/if}
    {#if ov?.defaults.length}
      <p class="dimtext note">No modem file for {phoneList(ov.defaults)}: they run the modem's defaults.</p>
    {/if}

    {#if sel}
      {@const phone = sel.phones[0]}
      {@const caps = phone?.family ? modemCapabilities(phone.family) : undefined}
      <!-- The file's own sections follow at the top level; its name heads them rather than boxing them. -->
      <p class="note">
        <b class="mono wrap">{sel.path}</b>
        <span class="dimtext">
          {#if phone?.family}
            <a href={link(`/builds/${ov?.build}/${phone.family}`)}>Modem package</a>{caps?.carrierConfigIn === "bundle" ? "; this file is its whole carrier config" : ""}.
          {:else if sel.phones.length}
            for board {sel.phones.map((p) => p.id).join(", ")}, a phone this site cannot name yet.
          {:else}
            not named for a phone; read alongside each phone's own file where its modem uses this kind of file.
          {/if}
        </span>
      </p>
      <FileBody
        file={await getFile({ ...args, slug: sel.slug, path: sel.path })}
        cc={bundle.cc}
        raw={rawHref(params.kind, params.name, sel.slug, sel.path)}
        devices={false}
      />
      {#if params.kind === "carriers" && phone && caps?.plaintextDefaults}
        <ModemDefaults kind={params.kind} name={params.name} slug={params.version} device={phone.id} phone={phoneList(sel.phones)} />
      {/if}
    {/if}
  </Pane>
</div>
