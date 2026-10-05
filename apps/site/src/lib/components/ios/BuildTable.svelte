<script lang="ts">
  import { buildHref, modemHref } from "#lib/format.ts";
  import { releaseLabel } from "#lib/naming.ts";
  import type { ReleaseSummary } from "@carrier-explode/schema/types";
  import VersionMark from "../VersionMark.svelte";

  /** The iOS images held, each with the modem packages that changed since the image before. */
  let { builds }: { builds: ReadonlyArray<Extract<ReleaseSummary, { platform: "ios" }>> } = $props();
</script>

<fieldset class="hgroup">
  <legend>iOS builds ({builds.length})</legend>
  <table class="grid">
    <thead><tr><th>iOS</th><th>Build</th><th>Modem packages</th></tr></thead>
    <tbody>
      {#each builds as b, i (b.id)}
        <!-- Each row names only the packages that differ from the next older image with any; the oldest only counts. -->
        {@const before = builds.slice(i + 1).find((x) => x.modemFamilies.length)?.modemFamilies ?? b.modemFamilies}
        {@const added = b.modemFamilies.filter((f) => !before.some((x) => x.code === f.code))}
        {@const gone = b.modemFamilies.length ? before.filter((f) => !b.modemFamilies.some((x) => x.code === f.code)) : []}
        <tr>
          <td class="k"><a class="picker-opt" href={buildHref(b.platform, b.id)}><VersionMark platform={b.platform} version={b.version} />{releaseLabel(b)}</a></td>
          <td class="mono">{b.id}</td>
          <td>
            {#if b.modemFamilies.length}
              {b.modemFamilies.length}
              {#if added.length}<span class="dimtext">new:</span> {#each added as f, j (f.code)}{#if j}, {/if}<a href={modemHref("ios", b.id, f.code)}>{f.name}</a>{/each}{/if}
              {#if gone.length}<span class="dimtext">gone:</span> {gone.map((f) => f.name).join(", ")}{/if}
            {:else}
              <span class="dimtext">not extracted</span>
            {/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="3" class="dimtext">No images held.</td></tr>
      {/each}
    </tbody>
  </table>
</fieldset>
