<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getBundle, getFile } from "$lib/api/bundles.remote";
  import { getBundleModems } from "$lib/api/tables.remote";
  import { modemCapabilities, modemLabel } from "$lib/decode";
  import { bundleArgs, link, rawHref, withParams } from "$lib/format";
  import { modemFor, overridesFor, phoneList, sharedPri } from "$lib/phones";
  import Pane from "$lib/components/Pane.svelte";
  import FileBody from "$lib/components/FileBody.svelte";
  import ModemDefaults from "$lib/components/ModemDefaults.svelte";
  import PhonePicker from "$lib/components/PhonePicker.svelte";

  let { params } = $props();

  const args = $derived(bundleArgs(params));
  const wanted = $derived(page.url.searchParams.get("phone"));
  const shown = $derived(page.url.searchParams.get("file"));

  // A phone picked by hand drops the package file compared for the one before.
  const pick = (phone: string, restored: boolean) =>
    goto(withParams(page.url, restored ? { phone } : { phone, pri: null, efs: null, base: null }), { replaceState: true, keepFocus: true, noScroll: true });
</script>

<div class="scroll pad">
  <Pane>
    {@const bundle = await getBundle(args)}
    {@const mm = await getBundleModems(args)}
    {@const shared = sharedPri(bundle.info.files)}
    {#if mm}
      {@const phone = [wanted, mm.home].find((p) => p && modemFor(mm.modems, p)) ?? mm.modems[0]?.devices[0]?.id}
      {@const m = modemFor(mm.modems, phone)}
      {@const name = m?.devices.find((d) => d.id === phone)?.name ?? phone ?? "this phone"}
      {@const files = phone ? overridesFor(bundle.info.files, phone) : []}
      {@const home = modemFor(mm.modems, mm.extractedFrom?.id)}
      {@const pkg = m && link(`/baseband/${mm.build}/${m.family}`)}
      {@const caps = m && modemCapabilities(m.family)}

      <PhonePicker modems={mm.modems} {phone} named={!!wanted} onpick={pick} />
      <p class="dimtext note">
        {#if mm.source === "image"}
          This copy came out of the iOS {mm.version} ({mm.build}) image{mm.extractedFrom ? ` for ${mm.extractedFrom.name}` : ""}; phones are that build's.
        {:else}
          An OTA bundle, read against the current release, iOS {mm.version} ({mm.build}).
        {/if}
      </p>

      <h3 class="phone">{name} {#if m}<a class="dimtext" href={pkg}>{modemLabel(m.family)}</a>{/if}</h3>

      {#each files as f (f.path)}
        <fieldset class="hgroup">
          <legend class="mono wrap">{f.path}</legend>
          {#if m && caps?.carrierConfigIn === "bundle"}
            <p class="dimtext note">On {modemLabel(m.family)} phones this file is the whole modem carrier config: the modem package carries none.</p>
          {/if}
          {#if f.devices && f.devices.length > 1}
            <p class="dimtext note">Also read by {phoneList(f.devices.flatMap((d) => (d.ids && d.ids !== phone ? [{ id: d.ids, name: d.name }] : [])))}.</p>
          {/if}
          <FileBody
            file={await getFile({ ...args, slug: params.version, path: f.path })}
            cc={bundle.cc}
            raw={rawHref(params.kind, params.name, params.version, f.path)}
            devices={false}
          />
        </fieldset>
      {:else}
        {#if mm.source === "image" && home && m && home.family !== m.family}
          <div class="banner">
            No override file for {name} in this copy, and that says nothing about the carrier: an image's bundles only hold the files of the
            phones sharing the extracting phone's modem ({modemLabel(home.family)}: {phoneList(home.devices)}).
          </div>
        {:else}
          <p class="note">
            No modem overrides for {name}: this carrier uses the package defaults{#if pkg}{" "}(<a href={pkg}>{modemLabel(m.family)} package</a>){/if}.
          </p>
        {/if}
      {/each}

      {#if params.kind === "carriers" && phone && caps?.plaintextDefaults}
        <ModemDefaults kind={params.kind} name={params.name} slug={params.version} device={phone} phone={name} />
      {:else if m && caps?.carrierConfigIn === "package" && !caps.plaintextDefaults}
        <p class="dimtext note">The {m.family} package holds no plaintext config to compare against.</p>
      {/if}
    {:else}
      <p class="dimtext note">No iOS image to read this bundle's phones from.</p>
    {/if}

    {#if shared.length}
      <fieldset class="hgroup">
        <legend>For every phone</legend>
        <div class="rowflex">
          {#each shared as f (f.path)}
            <a class="chip mono" href={withParams(page.url, { file: f.path === shown ? null : f.path })} aria-current={f.path === shown ? "true" : undefined} data-sveltekit-noscroll data-sveltekit-replacestate>{f.path}</a>
          {/each}
        </div>
        {#if shown && shared.some((f) => f.path === shown)}
          <Pane>
            <FileBody
              file={await getFile({ ...args, slug: params.version, path: shown })}
              cc={bundle.cc}
              raw={rawHref(params.kind, params.name, params.version, shown)}
            />
          </Pane>
        {/if}
      </fieldset>
    {/if}
  </Pane>
</div>

<style>
  h3.phone { margin: 8px 0 4px; font-size: 14px; }
  h3.phone a { font-size: 12px; font-weight: normal; margin-left: 4px; }
  a.chip[aria-current] { background: var(--sel); color: var(--sel-text); }
  @media (max-width: 760px) {
    a.chip { padding: 5px 8px; white-space: normal; word-break: break-all; }
  }
</style>
