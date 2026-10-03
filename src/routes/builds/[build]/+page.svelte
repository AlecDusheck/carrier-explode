<script lang="ts">
  import { getRelease } from "#lib/api/bundles.remote.ts";
  import { getModems } from "#lib/api/tables.remote.ts";
  import { modemLabel } from "#lib/decode/index.ts";
  import { bundleHref, link } from "#lib/format.ts";
  import { imageSlug } from "#lib/names.ts";
  import { phoneList } from "#lib/phones.ts";
  import Pane from "#lib/components/Pane.svelte";

  let { params } = $props();

  const KINDS = [["carriers", "Carrier bundles"], ["countries", "Country bundles"]] as const;
</script>

<div class="view">
  <div class="scroll pad">
    <Pane>
      {@const [r, mods] = await Promise.all([getRelease(params.build), getModems(params.build)])}
      {@const slug = imageSlug(r.image.version)}
      <div class="filters">
        <a class="btn" href={link("/builds")}>iOS builds</a>
        <b>iOS {r.image.version}</b>
        <span class="mono">{r.image.build}</span>
        {#if r.previous}
          <span class="dimtext">since</span>
          <a href={link("/builds/" + r.previous.build)}>iOS {r.previous.version} ({r.previous.build})</a>
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

      {#each KINDS as [kind, title] (kind)}
        {@const d = r[kind]}
        <fieldset class="hgroup">
          <legend>{title}: {d.changed.length} changed, {d.added.length} added, {d.removed.length} removed</legend>
          {#if d.added.length}
            <p class="names"><b>Added</b>
              {#each d.added as name (name)}<a class="chip good" href={bundleHref(kind, name, slug)}>{name}</a>{/each}
            </p>
          {/if}
          {#if d.removed.length}
            <p class="names"><b>Removed</b>
              {#each d.removed as name (name)}<a class="chip bad" href={bundleHref(kind, name)}>{name}</a>{/each}
            </p>
          {/if}
          {#if d.changed.length}
            <table class="grid">
              <thead><tr><th>Bundle</th><th class="num">From</th><th class="num">To</th><th></th></tr></thead>
              <tbody>
                {#each d.changed as c (c.name)}
                  <tr>
                    <td class="k"><a href={bundleHref(kind, c.name, slug)}>{c.name}</a></td>
                    <td class="num mono">{c.from}</td>
                    <td class="num mono">{c.to}</td>
                    <td><a href={bundleHref(kind, c.name, slug, "changes")}>Changes</a></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else if !d.added.length && !d.removed.length}
            <p class="dimtext note">Same as the image before.</p>
          {/if}
        </fieldset>
      {/each}
    </Pane>
  </div>
</div>

<style>
  .names { margin: 0 0 6px; }
  .names b { margin-right: 6px; }
</style>
