<script lang="ts">
  import { goto } from "$app/navigation";
  import { navigating, page } from "$app/state";
  import { getBundle, getFile } from "$lib/api/bundles.remote";
  import { getBundleOverrides } from "$lib/api/tables.remote";
  import { modemCapabilities, modemLabel } from "$lib/decode";
  import { bundleArgs, link, rawHref, withParams } from "$lib/format";
  import type { PublicEntry } from "$lib/types";
  import { phoneList, sharedPri } from "$lib/phones";
  import Pane from "$lib/components/Pane.svelte";
  import FileBody from "$lib/components/FileBody.svelte";
  import ModemDefaults from "$lib/components/ModemDefaults.svelte";

  let { params } = $props();

  const args = $derived(bundleArgs(params));

  /** "OTA build 72.1 (iOS 27.0+)": the copy a file was read from, when not this one. */
  const copyLabel = (e: Pick<PublicEntry, "source" | "ios" | "build">) =>
    e.source === "image" ? `iOS ${e.ios[0]} image` : `OTA build ${e.build}${e.ios.length ? ` (iOS ${e.ios[0]}+)` : ""}`;
  // Picking a file drops the package file compared for the one before.
  const pickHref = (path: string, copy?: string) =>
    withParams(page.url, { file: path, copy: copy ?? null, pri: null, efs: null, base: null });
  const families = (phones: Array<{ family: string }>) => [...new Set(phones.map((p) => p.family))];

  const picked = (u: URL) => ({ file: u.searchParams.get("file"), copy: u.searchParams.get("copy") ?? undefined });
  const shown = $derived(picked(page.url));
  // The clicked row lights up before its file has loaded.
  const lit = $derived(navigating.to ? picked(navigating.to.url) : shown);

  /** A click anywhere on a row but its links picks the row's file. */
  const rowClick = (href: string) => (e: MouseEvent) => {
    if (!(e.target as Element).closest("a")) goto(href, { replaceState: true, noScroll: true, keepFocus: true });
  };
</script>

{#snippet modems(phones: Array<{ family: string }>, build: string)}
  {#each families(phones) as f, i (f)}{i ? ", " : ""}<a href={link(`/baseband/${build}/${f}`)}>{modemLabel(f)}</a>{/each}
{/snippet}

<div class="scroll pad">
  <Pane>
    {@const bundle = await getBundle(args)}
    {@const ov = await getBundleOverrides(args)}
    {@const here = bundle.entry.slug}
    <!-- Files named for phones, then the ones named for none. -->
    {@const rows = [
      ...(ov?.files ?? []).map((f) => ({ ...f, copy: f.slug === here ? undefined : f.slug })),
      ...sharedPri(bundle.info.files).map((f) => ({ ...bundle.entry, path: f.path, copy: undefined, phones: [] })),
    ]}
    {@const find = (k: typeof shown) => (k.file ? rows.find((r) => r.path === k.file && r.copy === k.copy) : undefined)
      ?? rows.find((r) => r.phones.some((p) => p.id === ov?.home)) ?? rows[0]}
    {@const sel = find(shown)}
    {@const litRow = find(lit)}

    {#if rows.length || ov?.defaults.length || ov?.unknown.length}
      <div class="hscroll">
        <table class="grid">
          <thead><tr><th>Phones</th><th>Modem</th><th>Override file</th></tr></thead>
          <tbody>
            {#each rows as r (r.slug + r.path)}
              <tr class="pick" class:sel={r === litRow} onclick={rowClick(pickHref(r.path, r.copy))}>
                <td>{r.phones.length ? phoneList(r.phones) : "Not named for a phone"}</td>
                <td>{#if ov}{@render modems(r.phones, ov.build)}{/if}</td>
                <td>
                  <a class="mono wrap" href={pickHref(r.path, r.copy)} data-sveltekit-noscroll data-sveltekit-replacestate aria-current={r === litRow ? "true" : undefined}>{r.path}</a>
                  {#if r.copy}<span class="dimtext sp">from {copyLabel(r)}</span>{/if}
                </td>
              </tr>
            {/each}
            {#if ov?.defaults.length}
              <tr><td>{phoneList(ov.defaults)}</td><td>{@render modems(ov.defaults, ov.build)}</td><td class="dimtext">None: package defaults</td></tr>
            {/if}
            {#if ov?.unknown.length}
              <tr><td>{phoneList(ov.unknown)}</td><td>{@render modems(ov.unknown, ov.build)}</td><td class="dimtext">Unknown: no copy of this bundle made for them</td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="dimtext note">No modem override files.</p>
    {/if}

    {#if sel}
      {@const phone = sel.phones[0]}
      {@const caps = phone && modemCapabilities(phone.family)}
      <fieldset class="hgroup">
        <legend class="mono wrap">{sel.path}</legend>
        {#if caps?.carrierConfigIn === "bundle"}
          <p class="dimtext note">The whole carrier config on {modemLabel(phone.family)} phones.</p>
        {/if}
        <FileBody
          file={await getFile({ ...args, slug: sel.slug, path: sel.path })}
          cc={bundle.cc}
          raw={rawHref(params.kind, params.name, sel.slug, sel.path)}
          devices={false}
        />
      </fieldset>
      {#if params.kind === "carriers" && phone && caps?.plaintextDefaults}
        <ModemDefaults kind={params.kind} name={params.name} slug={params.version} device={phone.id} phone={phoneList(sel.phones)} />
      {/if}
    {/if}
  </Pane>
</div>

<style>
  a[aria-current] { font-weight: bold; }
  tr.pick { cursor: pointer; }
</style>
