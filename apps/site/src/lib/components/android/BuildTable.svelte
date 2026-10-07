<script lang="ts">
  import { getCarriersShipped, getPhoneNames } from "#lib/api/builds.remote.ts";
  import { buildHref } from "#lib/format.ts";
  import { releaseLabel } from "#lib/naming.ts";
  import type { ListedRelease } from "@carrier-explode/db";
  import VersionMark from "../VersionMark.svelte";

  /** The Pixel builds held, each with its phones and how many of the carrier list's carriers it ships. */
  let { builds }: { builds: ReadonlyArray<Extract<ListedRelease, { platform: "android" }>> } = $props();

  const names = $derived(new Map(await getPhoneNames("android")));
  const carriers = $derived(new Map(await getCarriersShipped("android")));
</script>

<fieldset class="hgroup">
  <legend>Android builds ({builds.length})</legend>
  <table class="grid">
    <thead><tr><th>Android</th><th>Phones</th><th>Build</th><th>Carriers</th></tr></thead>
    <tbody>
      {#each builds as b (b.id)}
        <tr>
          <td class="k"><a class="picker-opt" href={buildHref(b.platform, b.id)}><VersionMark platform={b.platform} version={b.version} />{releaseLabel(b)}</a></td>
          <td>{b.devices.map((d) => names.get(d) ?? d).join(", ")}</td>
          <td class="mono">{b.id}</td>
          <td>{carriers.get(b.id) ?? ""}</td>
        </tr>
      {:else}
        <tr><td colspan="4" class="dimtext">No Pixel builds held.</td></tr>
      {/each}
    </tbody>
  </table>
</fieldset>
