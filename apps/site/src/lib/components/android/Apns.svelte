<script lang="ts">
  import { getAndroidApns } from "#lib/api/android.remote.ts";
  import { getSourceHead } from "#lib/api/sources.remote.ts";
  import { verArgs } from "#lib/format.ts";
  import { NO_DOCS } from "#lib/tree-docs.ts";
  import { TreeState } from "#lib/ui-state.svelte.ts";
  import { sourceKey } from "@carrier-explode/schema/types";
  import type { TabProps } from "#lib/types.ts";
  import Tree from "../Tree.svelte";
  import TreeToolbar from "../TreeToolbar.svelte";

  /** Each APN under its name, its fields in the value tree. */
  let { at }: TabProps = $props();

  const tree = new TreeState();
  const [apns, head] = $derived(await Promise.all([getAndroidApns(verArgs(at)), getSourceHead(verArgs(at))]));
  const ctx = $derived({ platform: at.ref.platform, source: sourceKey(at.ref), file: "", cc: head.cc ?? undefined, docs: NO_DOCS });
</script>

<TreeToolbar state={tree} label="filter APN fields" />
{#each apns as a, i (i)}
  <fieldset class="hgroup">
    <legend>{a.name ?? "unnamed"} <span class="mono dimtext">{a.value ?? ""}</span></legend>
    <Tree value={a} {ctx} state={tree} root="apns[{i}]" />
  </fieldset>
{:else}
  <p class="dimtext note">No APNs.</p>
{/each}
