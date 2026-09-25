<script lang="ts" module>
  export interface TreeCtx { file: string; cc?: string }
</script>

<script lang="ts">
  import { isJsonDict } from "$lib/decode";
  import { plainJson } from "$lib/format";
  import { Folding } from "$lib/ui-state.svelte";
  import TreeNode from "./TreeNode.svelte";
  import TreeToolbar from "./TreeToolbar.svelte";

  let { value, ctx, root = "" }: { value: unknown; ctx: TreeCtx; root?: string } = $props();

  let filter = $state("");
  let raw = $state(false);
  let notes = $state(false);
  const fold = new Folding();

  const entries = $derived(isJsonDict(value) ? Object.entries(value) : null);
  const prefix = $derived(root ? root + "." : "");
  const onfilter = (p: string) => (filter = p);
</script>

{#if value === undefined || value === null}
  <p class="dimtext">Nothing to show.</p>
{:else}
  <TreeToolbar bind:filter bind:notes {fold} name="tree-filter" label="filter keys and values">
    <button class="btn" class:on={raw} aria-pressed={raw} onclick={() => (raw = !raw)}>JSON</button>
  </TreeToolbar>
  {#if raw}
    <pre class="code">{plainJson(value, 2)}</pre>
  {:else}
    <div class="tree">
      {#if entries}
        {#each entries as [k, v] (k)}
          <TreeNode name={k} value={v} path={prefix + k} {filter} {fold} {notes} {ctx} {onfilter} />
        {/each}
      {:else}
        <TreeNode name={root || "value"} {value} path={root || "value"} {filter} {fold} {notes} {ctx} {onfilter} />
      {/if}
    </div>
  {/if}
{/if}
