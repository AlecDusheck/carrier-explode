<script lang="ts" module>
  import type { Platform } from "#lib/schema/types.ts";

  /** Where a tree's values come from: what its keys are documented by and what "compare across" scans. */
  export interface TreeCtx {
    readonly platform: Platform;
    /** The source key. */
    readonly source: string;
    /** The file (iOS member path, or Android `config`) the tree's paths are inside. */
    readonly file: string;
    /** The source's country, for "compare across its carriers". */
    readonly cc?: string | undefined;
  }
  /** A tag beside a top-level key: where its value came from, or how rare it is. */
  export interface KeyBadge { text: string; tone?: "phone" | "rare" | "country"; title?: string }
</script>

<script lang="ts">
  import { isJsonDict } from "#lib/decode/index.ts";
  import { TreeState } from "#lib/ui-state.svelte.ts";
  import TreeNode from "./TreeNode.svelte";
  import TreeToolbar from "./TreeToolbar.svelte";

  interface Props {
    value: unknown;
    ctx: TreeCtx;
    /** Shared with a toolbar elsewhere on the page; without it the tree has its own. */
    state?: TreeState | undefined;
    badges?: Record<string, KeyBadge[]> | undefined;
  }

  let { value, ctx, state, badges }: Props = $props();

  const own = new TreeState();
  const st = $derived(state ?? own);

  const entries = $derived(isJsonDict(value) ? Object.entries(value) : null);
  const onfilter = (p: string) => (st.filter = p);
</script>

{#if value === undefined || value === null}
  <p class="dimtext">Nothing to show.</p>
{:else}
  {#if !state}<TreeToolbar state={own} />{/if}
  <div class="tree">
    {#if entries}
      {#each entries as [k, v] (k)}
        <TreeNode name={k} value={v} path={k} filter={st.filter} {ctx} {onfilter} badges={badges?.[k]} />
      {/each}
    {:else}
      <TreeNode name="value" {value} path="value" filter={st.filter} {ctx} {onfilter} />
    {/if}
  </div>
{/if}
