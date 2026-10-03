<script lang="ts">
  import { getRelease } from "#lib/api/bundles.remote.ts";
  import { getBasebandBuilds, getModems } from "#lib/api/tables.remote.ts";
  import { modemLabel } from "#lib/decode/index.ts";
  import { bundleHref, link } from "#lib/format.ts";
  import { imageSlug } from "#lib/names.ts";
  import { phoneList } from "#lib/phones.ts";
  import Pane from "#lib/components/Pane.svelte";
  import BuildPicker from "#lib/components/BuildPicker.svelte";
  import IosIcon from "#lib/components/IosIcon.svelte";
  import BundleChip from "#lib/components/BundleChip.svelte";
  import BundleIcon from "#lib/components/BundleIcon.svelte";

  let { params } = $props();

  const KINDS = [["carriers", "Carrier bundles", "carrier"], ["countries", "Country bundles", "country"]] as const;
  const same = (d: { changed: unknown[]; added: unknown[]; removed: unknown[] }) => !d.changed.length && !d.added.length && !d.removed.length;
</script>

<div class="view">
  <div class="scroll pad">
    <Pane>
      {@const [r, mods, builds] = await Promise.all([getRelease(params.build), getModems(params.build), getBasebandBuilds()])}
      {@const slug = imageSlug(r.image.version)}
      <div class="filters">
        <BuildPicker {builds} current={params.build} href={(b) => link("/builds/" + b.build)} />
        {#if r.previous}
          <span class="dimtext">since</span>
          <a class="picker-opt" href={link("/builds/" + r.previous.build)}><IosIcon version={r.previous.version} />iOS {r.previous.version} ({r.previous.build})</a>
        {:else}
          <span class="dimtext">oldest image held</span>
        {/if}
      </div>

      <fieldset class="hgroup">
        <legend>Modem packages ({mods.modems.length})</legend>
        <p class="dimtext note">The modem defaults each iPhone starts from before its carrier bundle's modem file.</p>
        <table class="grid">
          <thead><tr><th>Modem</th><th>iPhones</th></tr></thead>
          <tbody>
            {#each mods.modems as m (m.family)}
              <tr>
                <td class="k"><a href={link(`/builds/${params.build}/${m.family}`)}>{modemLabel(m.family)}</a></td>
                <td>{phoneList(m.devices)}</td>
              </tr>
            {:else}
              <tr><td colspan="2" class="dimtext">No modem packages extracted from this image yet.</td></tr>
            {/each}
          </tbody>
        </table>
      </fieldset>

      {#if KINDS.every(([k]) => same(r[k]))}
        <p class="note">No carrier or country bundle changes.</p>
      {:else}
        {#each KINDS as [kind, title, noun] (kind)}
          {@const d = r[kind]}
          {#if same(d)}
            <p class="note">No {noun} bundle changes.</p>
          {:else}
            <fieldset class="hgroup">
              <legend>{title}: {d.changed.length} changed, {d.added.length} added, {d.removed.length} removed</legend>
              {#if d.added.length}
                <p class="names"><b>Added</b>
                  {#each d.added as name (name)}<BundleChip {kind} {name} {slug} tone="good" />{/each}
                </p>
              {/if}
              {#if d.removed.length}
                <p class="names"><b>Removed</b>
                  {#each d.removed as name (name)}<BundleChip {kind} {name} tone="bad" />{/each}
                </p>
              {/if}
              {#if d.changed.length}
                <table class="grid">
                  <thead><tr><th>Bundle</th><th class="num">Version</th></tr></thead>
                  <tbody>
                    {#each d.changed as c (c.name)}
                      <tr>
                        <td class="k name"><a class="picker-opt" href={bundleHref(kind, c.name, slug)}><BundleIcon {kind} name={c.name} />{c.name}</a></td>
                        <!-- The version links to what changed; a content change can keep the version. -->
                        <td class="num mono"><a href={bundleHref(kind, c.name, slug, "changes")}>{c.from === c.to ? c.to : `${c.from} → ${c.to}`}</a></td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
            </fieldset>
          {/if}
        {/each}
      {/if}
    </Pane>
  </div>
</div>

<style>
  .names { margin: 0 0 6px; }
  /* Long bundle names wrap rather than push the table past a phone's width. */
  td.name { white-space: normal; overflow-wrap: anywhere; }
  .names b { margin-right: 6px; }
</style>
