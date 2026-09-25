<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getBundle, getFile } from "$lib/api/bundles.remote";
  import { getBundleModems } from "$lib/api/tables.remote";
  import { modemLabel } from "$lib/decode/modem";
  import { bundleArgs, link, rawHref, withParams } from "$lib/format";
  import { modemFor, overridesFor, phoneList, sharedPri, sortPhones } from "$lib/phones";
  import Pane from "$lib/components/Pane.svelte";
  import FileBody from "$lib/components/FileBody.svelte";
  import ModemDefaults from "$lib/components/ModemDefaults.svelte";

  let { params } = $props();

  // ?phone= is what a page shows and shares; the remembered phone only fills in a URL without one.
  const KEY = "baseband-phone";
  const args = $derived(bundleArgs(params));
  const wanted = $derived(page.url.searchParams.get("phone"));
  const shown = $derived(page.url.searchParams.get("file"));
  const nav = (changes: Record<string, string | null>) =>
    goto(withParams(page.url, changes), { replaceState: true, keepFocus: true, noScroll: true });

  function pick(phone: string) {
    try { localStorage.setItem(KEY, phone); } catch { /* remembering is a convenience */ }
    nav({ phone, pri: null, efs: null, base: null });
  }

  $effect(() => {
    if (wanted) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* no storage, no memory */ }
    if (!saved) return;
    const phone = saved;
    getBundleModems(args).then((m) => {
      if (m && modemFor(m.modems, phone) && !page.url.searchParams.get("phone")) nav({ phone });
    });
  });
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

      <div class="rowflex picker">
        <label class="lbl grow">
          Phone
          <select class="grow" name="phone" value={phone} onchange={(e) => pick(e.currentTarget.value)}>
            {#each mm.modems as x (x.family)}
              <optgroup label={modemLabel(x.family)}>
                {#each sortPhones(x.devices) as d (d.id)}<option value={d.id}>{d.name ?? d.id}</option>{/each}
              </optgroup>
            {/each}
          </select>
        </label>
      </div>
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
          {#if m?.vendor === "apple"}
            <p class="dimtext note">On {modemLabel(m.family)} phones this file is the whole modem carrier config: the modem package carries none.</p>
          {/if}
          {#if f.devices && f.devices.length > 1}
            <p class="dimtext note">Also read by {phoneList(f.devices.filter((d) => d.ids && d.ids !== phone).map((d) => ({ id: d.ids!, name: d.name })))}.</p>
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

      {#if params.kind === "carriers" && phone && m?.vendor === "qualcomm"}
        <ModemDefaults kind={params.kind} name={params.name} slug={params.version} device={phone} phone={name} />
      {:else if m?.vendor === "intel"}
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
  .note { margin: 0 0 6px; }
  .picker { margin-bottom: 4px; }
  .picker select { min-width: 0; }
  h3.phone { margin: 8px 0 4px; font-size: 14px; }
  h3.phone a { font-size: 12px; font-weight: normal; margin-left: 4px; }
  a.chip[aria-current] { background: var(--sel); color: var(--sel-text); }
  @media (max-width: 760px) {
    a.chip { padding: 5px 8px; white-space: normal; word-break: break-all; }
  }
</style>
