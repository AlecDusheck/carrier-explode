<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getBundle, getFile } from "$lib/api/bundles.remote";
  import { getBundleModems, getPhoneOverrides } from "$lib/api/tables.remote";
  import { modemCapabilities, modemLabel } from "$lib/decode";
  import { bundleArgs, bundleHref, link, rawHref, withParams } from "$lib/format";
  import type { PublicEntry } from "$lib/types";
  import { modemFor, overridesFor, phoneList, sharedPri } from "$lib/phones";
  import Pane from "$lib/components/Pane.svelte";
  import FileBody from "$lib/components/FileBody.svelte";
  import ModemDefaults from "$lib/components/ModemDefaults.svelte";
  import PhonePicker from "$lib/components/PhonePicker.svelte";

  let { params } = $props();

  const args = $derived(bundleArgs(params));
  const wanted = $derived(page.url.searchParams.get("phone"));
  const shown = $derived(page.url.searchParams.get("file"));

  /** "OTA build 72.1 (iOS 27.0+)": the copy a phone's files were read from. */
  const copyLabel = (e: Pick<PublicEntry, "source" | "ios" | "build">) =>
    e.source === "image" ? `iOS ${e.ios[0]} image` : `OTA build ${e.build}${e.ios.length ? ` (iOS ${e.ios[0]}+)` : ""}`;
  const copyHref = (slug: string, phone: string) =>
    `${bundleHref(params.kind, params.name, slug, "baseband")}?phone=${encodeURIComponent(phone)}`;

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
      {@const copy = phone ? await getPhoneOverrides({ ...args, device: phone }) : null}
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

      {#if copy?.entry && phone && !copy.sameCopy}
        <!-- Phones this copy has files for, to say why another copy is shown. -->
        {@const covered = mm.modems.flatMap((x) => x.devices).filter((d) => overridesFor(bundle.info.files, d.id).length)}
        <p class="dimtext note">
          From <a href={copyHref(copy.entry.slug, phone)}>{copyLabel(copy.entry)}</a> — this
          {bundle.entry.source === "image" ? `iOS ${bundle.entry.ios[0]} image copy` : "copy"}
          {covered.length ? `only carries files for ${phoneList(covered)}` : "carries no phone's override files"}.
        </p>
      {/if}

      {#if copy?.entry}
        {#each copy.files as f (f.path)}
          <fieldset class="hgroup">
            <legend class="mono wrap">{f.path}</legend>
            {#if m && caps?.carrierConfigIn === "bundle"}
              <p class="dimtext note">On {modemLabel(m.family)} phones this file is the whole modem carrier config: the modem package carries none.</p>
            {/if}
            {#if f.devices && f.devices.length > 1}
              <p class="dimtext note">Also read by {phoneList(f.devices.flatMap((d) => (d.ids && d.ids !== phone ? [{ id: d.ids, name: d.name }] : [])))}.</p>
            {/if}
            <FileBody
              file={await getFile({ ...args, slug: copy.entry.slug, path: f.path })}
              cc={bundle.cc}
              raw={rawHref(params.kind, params.name, copy.entry.slug, f.path)}
              devices={false}
            />
          </fieldset>
        {/each}
      {:else if copy?.known}
        <p class="note">
          No modem overrides for {name}: this carrier uses the package defaults{#if pkg}{" "}(<a href={pkg}>{modemLabel(m.family)} package</a>){/if}.
        </p>
      {:else if phone}
        <p class="note">
          No copy of this bundle held here was made for {name}, so whether it overrides the package for that phone is unknown.
        </p>
      {/if}

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
