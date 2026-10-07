<script lang="ts">
  import { getBuildModems } from "#lib/api/builds.remote.ts";
  import { phoneList } from "#lib/apple/phones.ts";
  import { modemHref } from "#lib/format.ts";
  import type { ListedRelease } from "@carrier-explode/db";
  import { RELEASE_VIEWS } from "./views.ts";

  /** The modems a build ships, each with the phones running it. */
  let { release }: { release: ListedRelease } = $props();

  const view = $derived(RELEASE_VIEWS[release.platform].modems);
  const mods = $derived(view === null ? [] : await getBuildModems({ platform: release.platform, build: release.id }));
</script>

{#if view !== null}
  <fieldset class="hgroup">
    <legend>{view.title} ({mods.length})</legend>
    {#if view.note}<p class="dimtext note">{view.note}</p>{/if}
    <table class="grid">
      <thead><tr><th>Modem</th><th>Phones</th></tr></thead>
      <tbody>
        {#each mods as m (m.id)}
          <tr>
            <td class="k"><a href={modemHref(release.platform, release.id, m.id)}>{m.label}</a> <span class="mono dimtext">{m.firmware}</span></td>
            <td>{phoneList(m.devices)}</td>
          </tr>
        {:else}
          <tr><td colspan="2" class="dimtext">{view.none}</td></tr>
        {/each}
      </tbody>
    </table>
  </fieldset>
{/if}
