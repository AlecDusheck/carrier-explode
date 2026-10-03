<script lang="ts" module>
  export interface TreeCtx { file: string; cc?: string }
  /** A tag beside a top-level key: where its value came from, or how rare it is. */
  export interface KeyBadge { text: string; tone?: "phone" | "rare" | "country"; title?: string }
</script>

<script lang="ts">
  import { isJsonDict } from "#lib/decode/index.ts";
  import { plainJson } from "#lib/format.ts";
  import { TreeState } from "#lib/ui-state.svelte.ts";
  import TreeNode from "./TreeNode.svelte";
  import TreeToolbar from "./TreeToolbar.svelte";

  let { value, ctx, root = "", state, badges }: {
    value: unknown;
    ctx: TreeCtx;
    root?: string;
    /** Shared with a toolbar elsewhere on the page; without it the tree has its own. */
    state?: TreeState;
    badges?: Record<string, KeyBadge[]>;
  } = $props();

  const own = new TreeState();
  const st = $derived(state ?? own);

  const entries = $derived(isJsonDict(value) ? Object.entries(value) : null);
  const prefix = $derived(root ? root + "." : "");
  const onfilter = (p: string) => (st.filter = p);
</script>

{#if value === undefined || value === null}
  <p class="dimtext">Nothing to show.</p>
{:else}
  {#if !state}<TreeToolbar state={own} />{/if}
  {#if st.raw}
    <pre class="code">{plainJson(value, 2)}</pre>
  {:else}
    <div class="tree">
      {#if entries}
        {#each entries as [k, v] (k)}
          <TreeNode name={k} value={v} path={prefix + k} filter={st.filter} fold={st.fold} notes={st.notes} {ctx} {onfilter} badges={badges?.[k]} />
        {/each}
      {:else}
        <TreeNode name={root || "value"} {value} path={root || "value"} filter={st.filter} fold={st.fold} notes={st.notes} {ctx} {onfilter} />
      {/if}
    </div>
  {/if}
{/if}
