<script lang="ts">
  import { getRelease } from "$lib/api/bundles.remote";
  import { bundleHref, link } from "$lib/format";
  import { imageSlug } from "$lib/names";
  import Pane from "$lib/components/Pane.svelte";

  let { params } = $props();

  const KINDS = [["carriers", "Carriers"], ["countries", "Countries"]] as const;
</script>

<div class="view">
  <div class="scroll pad">
    <Pane>
      {@const r = await getRelease(params.build)}
      {@const slug = imageSlug(r.image.version)}
      <div class="rowflex">
        <a class="btn" href={link("/releases")}>Releases</a>
        <b>iOS {r.image.version}</b>
        <span class="mono">{r.image.build}</span>
        {#if r.previous}
          <span class="dimtext">since</span>
          <a href={link("/releases/" + r.previous.build)}>iOS {r.previous.version} ({r.previous.build})</a>
        {:else}
          <span class="dimtext">oldest image held</span>
        {/if}
      </div>

      {#each KINDS as [kind, title] (kind)}
        {@const d = r[kind]}
        <fieldset class="hgroup">
          <legend>{title}: {d.total} total, {d.changed.length} changed, {d.added.length} added, {d.removed.length} removed</legend>
          {#if d.changed.length}
            <table class="grid">
              <thead><tr><th>Changed</th><th class="num">From</th><th class="num">To</th><th></th></tr></thead>
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
          {/if}
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
        </fieldset>
      {/each}
    </Pane>
  </div>
</div>

<style>
  .names { margin: 6px 0 0; }
  .names b { margin-right: 6px; }
</style>
