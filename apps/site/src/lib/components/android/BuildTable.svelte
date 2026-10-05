<script lang="ts">
  import { buildHref } from "#lib/format.ts";
  import { releaseLabel } from "#lib/naming.ts";
  import type { ReleaseSummary } from "@carrier-explode/schema/types";
  import VersionMark from "../VersionMark.svelte";

  /** The Pixel builds held, each with its security patch and how many sources it ships. */
  let { builds }: { builds: ReadonlyArray<Extract<ReleaseSummary, { platform: "android" }>> } = $props();
</script>

<fieldset class="hgroup">
  <legend>Android builds ({builds.length})</legend>
  <table class="grid">
    <thead><tr><th>Android</th><th>Build</th><th>Sources</th></tr></thead>
    <tbody>
      {#each builds as b (b.id)}
        <tr>
          <td class="k"><a class="picker-opt" href={buildHref(b.platform, b.id)}><VersionMark platform={b.platform} version={b.version} />{releaseLabel(b)}</a></td>
          <td class="mono">{b.id}</td>
          <td>{b.sourceCount}</td>
        </tr>
      {:else}
        <tr><td colspan="3" class="dimtext">No Pixel builds held.</td></tr>
      {/each}
    </tbody>
  </table>
</fieldset>
