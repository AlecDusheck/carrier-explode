<script lang="ts">
  import { getPhoneNames } from "#lib/api/builds.remote.ts";
  import { buildHref } from "#lib/format.ts";
  import { releaseLabel } from "#lib/naming.ts";
  import type { ListedRelease } from "@carrier-explode/db";
  import VersionMark from "../VersionMark.svelte";

  /** The Galaxy firmware held, each with its model and how many carrier packs it ships. */
  let { builds }: { builds: ReadonlyArray<Extract<ListedRelease, { platform: "samsung" }>> } = $props();

  const names = $derived(new Map(await getPhoneNames("samsung")));
</script>

<fieldset class="hgroup">
  <legend>Galaxy firmware ({builds.length})</legend>
  <table class="grid">
    <thead><tr><th>Android</th><th>Phones</th><th>Build</th><th>Packs</th></tr></thead>
    <tbody>
      {#each builds as b (b.id)}
        <tr>
          <td class="k"><a class="picker-opt" href={buildHref(b.platform, b.id)}><VersionMark platform={b.platform} version={b.version} />{releaseLabel(b)}</a></td>
          <td>{b.devices.map((d) => names.get(d) ?? d).join(", ")}</td>
          <td class="mono">{b.id}</td>
          <td>{b.sourceCount}</td>
        </tr>
      {:else}
        <tr><td colspan="4" class="dimtext">No Galaxy firmware held.</td></tr>
      {/each}
    </tbody>
  </table>
</fieldset>
