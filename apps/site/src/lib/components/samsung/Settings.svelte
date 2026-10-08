<script lang="ts">
  import { page } from "$app/state";
  import { getSamsungSettings } from "#lib/api/samsung.remote.ts";
  import { getRare, getSourceHead } from "#lib/api/sources.remote.ts";
  import { verArgs } from "#lib/format.ts";
  import { rareBadges } from "#lib/settings.ts";
  import { NO_DOCS } from "#lib/tree-docs.ts";
  import { TreeState } from "#lib/ui-state.svelte.ts";
  import { mainFile } from "@carrier-explode/schema";
  import { sourceKey, type Json } from "@carrier-explode/schema/types";
  import type { TabProps } from "#lib/types.ts";
  import Tree from "../Tree.svelte";
  import TreeToolbar from "../TreeToolbar.svelte";

  /** The pack's settings and feature switches, each a value tree headed by what it is and the file it is in; then the system IMS service's entries for the pack's operator. */
  let { at }: TabProps = $props();

  const tree = new TreeState();
  // A link from the Overview names the key to show.
  tree.filter = page.url.searchParams.get("filter") ?? "";

  const [groups, head, rare] = $derived(await Promise.all([getSamsungSettings(verArgs(at)), getSourceHead(verArgs(at)), getRare(verArgs(at))]));
  // Rarity is judged in the main file alone.
  const badges = $derived(rare.state === "judged" ? rareBadges(rare.rows) : {});
  const main = $derived(mainFile(at.ref.platform));
</script>

{#snippet values(file: string, value: Json)}
  <Tree
    {value}
    ctx={{ platform: at.ref.platform, source: sourceKey(at.ref), file, cc: head.cc ?? undefined, docs: NO_DOCS }}
    state={tree}
    badges={file === main ? badges : undefined}
  />
{/snippet}

<TreeToolbar state={tree} label="filter settings" />

{#each groups as g (g.kind === "pack" ? g.file : g.mno)}
  <fieldset class="hgroup">
    {#if g.kind === "pack"}
      <legend>{g.title} <span class="mono dimtext">{g.file}</span></legend>
      {@render values(g.file, g.values)}
    {:else}
      <legend title="Not a pack file: the firmware's IMS service, its entry for the operator the pack's SIM rules match">
        System IMS, matched by SIM rules <span class="mono dimtext">{g.mno}</span>
      </legend>
      {#each g.files as f (f.file)}
        <p class="mono dimtext">{f.file}</p>
        {@render values(f.file, f.values)}
      {/each}
    {/if}
  </fieldset>
{/each}
