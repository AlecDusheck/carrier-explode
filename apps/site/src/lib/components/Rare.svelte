<script lang="ts">
  import { getRare } from "#lib/api/sources.remote.ts";
  import { verArgs, versionHref } from "#lib/format.ts";
  import { SOURCE_NOUNS } from "#lib/platforms.ts";
  import type { At } from "#lib/types.ts";
  import { decoderFamily } from "@carrier-explode/schema/types";
  import SourceChip from "./SourceChip.svelte";

  /** The settings at most three other sources of the same platform and kind share, from the last scan run. */
  let { at }: { at: At } = $props();

  const { one, many, settings } = $derived(SOURCE_NOUNS[decoderFamily(at.ref.platform)]);

  const rare = $derived(await getRare(verArgs(at)));
  const filterHref = (path: string): string => versionHref(at, "settings") + "?filter=" + encodeURIComponent(path.split(/[.[]/, 1)[0] ?? path);
</script>

<fieldset class="hgroup">
  <legend>Unique to this {one}{rare.indexed ? ` (${rare.rows.length})` : ""}</legend>
  {#if !rare.indexed}
    <p class="dimtext note">
      {rare.why === "old" ? `Only each ${one}'s newest version is compared across ${many}.` : `Not computed yet: the next index run compares every ${one}.`}
    </p>
  {:else if !rare.rows.length}
    <p class="dimtext note">Nothing in {settings} that at most three other {many} share.</p>
  {:else}
    <p class="dimtext note">{settings} settings at most three other {many} share.</p>
    <table class="grid">
      <thead><tr><th>Setting</th><th>Value</th><th>Also in</th></tr></thead>
      <tbody>
        {#each rare.rows as r (r.path + (r.rare === "value" ? r.value : ""))}
          <tr>
            <td class="mono"><a href={filterHref(r.path)}>{r.path}</a></td>
            <td class="mono">{r.rare === "value" ? r.value : "set"}</td>
            <td>{#each r.with as w (w)}<SourceChip source={w} />{:else}<span class="dimtext">none</span>{/each}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</fieldset>
