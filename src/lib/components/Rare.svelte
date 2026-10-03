<script lang="ts">
  import { getRare } from "#lib/api/bundles.remote.ts";
  import { verArgs, versionHref } from "#lib/format.ts";
  import type { At } from "#lib/types.ts";
  import SourceChip from "./SourceChip.svelte";

  /** The settings at most three other sources of the same platform and kind share, from the last scan run. */
  interface Props {
    at: At;
    /** What the settings file is called on this platform: carrier.plist, CarrierConfig. */
    file: string;
  }

  let { at, file }: Props = $props();

  const rare = $derived(await getRare(verArgs(at)));
  const filterHref = (path: string): string => versionHref(at, "settings") + "?filter=" + encodeURIComponent(path.split(/[.[]/, 1)[0] ?? path);
</script>

<fieldset class="hgroup">
  <legend>Unique to this source{rare.indexed ? ` (${rare.rows.length})` : ""}</legend>
  {#if !rare.indexed}
    <p class="dimtext note">
      {rare.why === "old" ? "Only each source's newest version is compared across sources." : "Not computed yet: the next index run compares every source."}
    </p>
  {:else if !rare.rows.length}
    <p class="dimtext note">Nothing in {file} that at most three other sources share.</p>
  {:else}
    <p class="dimtext note">{file} settings at most three other sources share.</p>
    <table class="grid">
      <thead><tr><th>Setting</th><th>Value</th><th>Also in</th></tr></thead>
      <tbody>
        {#each rare.rows as r (r.path + (r.value ?? ""))}
          <tr>
            <td class="mono wrap"><a href={filterHref(r.path)}>{r.path}</a></td>
            <td class="mono wrap">{r.value ?? "set"}</td>
            <td>{#each r.with as w (w)}<SourceChip source={w} />{:else}<span class="dimtext">none</span>{/each}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</fieldset>
