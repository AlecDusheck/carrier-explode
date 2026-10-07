<script lang="ts">
  import { getRare } from "#lib/api/sources.remote.ts";
  import { verArgs, versionHref } from "#lib/format.ts";
  import { rareSection } from "#lib/platforms.ts";
  import type { At } from "#lib/types.ts";
  import { decoderFamily } from "@carrier-explode/schema/types";
  import SourceChip from "./SourceChip.svelte";

  /** The settings few other sources of the same platform and kind share, among their newest versions; only a head with some has the section. */
  let { at }: { at: At } = $props();

  const rare = $derived(await getRare(verArgs(at)));
  const rows = $derived(rare.head ? rare.rows : []);
  const section = $derived(rareSection(decoderFamily(at.ref.platform), rows.length));
  const filterHref = (path: string): string => versionHref(at, "settings") + "?filter=" + encodeURIComponent(path.split(/[.[]/, 1)[0] ?? path);
</script>

{#if rows.length}
  <fieldset class="hgroup">
    <legend>{section.legend}</legend>
    <p class="dimtext note">{section.note}</p>
    <table class="grid">
      <thead><tr><th>Setting</th><th>Value</th><th>Also in</th></tr></thead>
      <tbody>
        {#each rows as r (`${r.path}\0${r.value}`)}
          <tr>
            <td class="mono"><a href={filterHref(r.path)}>{r.path}</a></td>
            <td class="mono">{r.value}</td>
            <td>{#each r.with as w (w)}<SourceChip source={w} />{/each}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </fieldset>
{/if}
