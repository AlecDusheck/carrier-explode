<script lang="ts">
  import { getSourceHead } from "#lib/api/sources.remote.ts";
  import { verArgs } from "#lib/format.ts";
  import { NO_DOCS } from "#lib/tree-docs.ts";
  import { TreeState } from "#lib/ui-state.svelte.ts";
  import { sourceKey } from "@carrier-explode/schema/types";
  import type { ApnView, At } from "#lib/types.ts";
  import Tree from "./Tree.svelte";
  import TreeToolbar from "./TreeToolbar.svelte";

  /** Each APN under its name, what it serves and its fields in the value tree; `file` is the one they are written in ("" for Android's CarrierSettings). */
  let { at, apns, file }: { at: At; apns: readonly ApnView[]; file: string } = $props();

  const tree = new TreeState();
  const head = $derived(await getSourceHead(verArgs(at)));
  const ctx = $derived({ platform: at.ref.platform, source: sourceKey(at.ref), file, cc: head.cc ?? undefined, docs: NO_DOCS });
</script>

<TreeToolbar state={tree} label="filter APN fields" />
{#each apns as a (a.root)}
  <fieldset class="hgroup">
    <legend>
      {a.name ?? "unnamed"} <span class="mono dimtext">{a.apn ?? ""}</span>
      {#each a.roles as r (r)}<span class="chip">{r}</span>{/each}
    </legend>
    <Tree value={a.fields} {ctx} state={tree} root={a.root} />
  </fieldset>
{:else}
  <p class="dimtext note">No APNs.</p>
{/each}
