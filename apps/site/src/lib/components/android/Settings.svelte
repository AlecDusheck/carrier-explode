<script lang="ts">
  import { page } from "$app/state";
  import { getAndroidSettings } from "#lib/api/android.remote.ts";
  import { getRare, getSourceHead } from "#lib/api/sources.remote.ts";
  import { verArgs } from "#lib/format.ts";
  import { rareBadges } from "#lib/settings.ts";
  import { androidDocs } from "#lib/android/tree-docs.ts";
  import { TreeState } from "#lib/ui-state.svelte.ts";
  import { sourceKey } from "@carrier-explode/schema/types";
  import type { TabProps } from "#lib/types.ts";
  import Tree, { type KeyBadge } from "../Tree.svelte";
  import TreeToolbar from "../TreeToolbar.svelte";

  /** CarrierConfig, the way the Apple tab shows carrier.plist: grouped value trees, each key's javadoc a click away. */
  let { at }: TabProps = $props();

  const tree = new TreeState();
  // A link from the Overview names the key to show.
  tree.filter = page.url.searchParams.get("filter") ?? "";

  const [settings, head, rare] = $derived(await Promise.all([getAndroidSettings(verArgs(at)), getSourceHead(verArgs(at)), getRare(verArgs(at))]));
  const ctx = $derived({ platform: at.ref.platform, source: sourceKey(at.ref), file: "config", cc: head.cc ?? undefined, docs: androidDocs(settings.docs) });

  /** Status first, then rarity. */
  const badges = $derived.by(() => {
    const out: Record<string, KeyBadge[]> = rare.head ? rareBadges(rare.rows) : {};
    for (const [key, doc] of Object.entries(settings.docs)) {
      const status: KeyBadge[] = [
        ...(doc.deprecated ? [{ text: "deprecated" }] : []),
        ...(doc.hidden ? [{ text: "hidden", title: "@hide: not in the public SDK" }] : []),
      ];
      if (status.length) out[key] = [...status, ...(out[key] ?? [])];
    }
    return out;
  });
</script>

<TreeToolbar state={tree} label="filter config keys" />

{#each settings.groups as g (g.title)}
  <fieldset class="hgroup">
    <legend>{g.title} ({Object.keys(g.values).length})</legend>
    <Tree value={g.values} {ctx} state={tree} {badges} />
  </fieldset>
{:else}
  <p class="dimtext note">No config keys.</p>
{/each}
