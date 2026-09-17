<script lang="ts">
  import TreeNode from "./TreeNode.svelte";

  interface Ctx { file: string; cc?: string; kind: "carrier" | "country" }

  let { value, ctx, root = "" }: { value: unknown; ctx: Ctx; root?: string } = $props();

  let filter = $state("");
  let epoch = $state(0);
  let gen = 0;
  let raw = $state(false);

  const isMap = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);

  const entries = $derived(isMap(value) ? Object.entries(value) : null);
  const prefix = $derived(root ? root + "." : "");
</script>

{#if value === undefined || value === null}
  <p class="dimtext">Nothing to show.</p>
{:else}
  <div class="rowflex" style="margin-bottom:6px">
    <input class="grow" style="min-width:120px" type="search" placeholder="filter keys and values" bind:value={filter} />
    <button class="btn" onclick={() => (epoch = ++gen)}>Expand</button>
    <button class="btn" onclick={() => (epoch = -++gen)}>Collapse</button>
    <button class="btn" class:on={raw} onclick={() => (raw = !raw)}>JSON</button>
  </div>
  {#if raw}
    <pre class="code">{JSON.stringify(value, null, 2)}</pre>
  {:else}
    <div class="tree">
      {#if entries}
        {#each entries as [k, v] (k)}
          <TreeNode name={k} value={v} path={prefix + k} {filter} {epoch} {ctx} onfilter={(p) => (filter = p)} />
        {/each}
      {:else}
        <TreeNode name={root || "value"} value={value} path={root || "value"} {filter} {epoch} {ctx} onfilter={(p) => (filter = p)} />
      {/if}
    </div>
  {/if}
{/if}
