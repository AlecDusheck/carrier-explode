<script lang="ts">
  import { getBaseband, getBasebandFile } from "#lib/api/tables.remote.ts";
  import { humanBytes } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import PolicyTree from "#lib/components/ios/PolicyTree.svelte";

  let { params } = $props();

  let source = $state(false);
</script>

<div class="scroll pad">
  <Pane>
    {@const bb = await getBaseband({ build: params.build, family: params.family })}
    {@const f = await getBasebandFile({ id: bb.id, i: Number(params.i) })}
    <div class="filters">
      <span class="mono breakall">{f.path}</span>
      <span class="dimtext">{f.format}, {f.member}, {humanBytes(f.length)}</span>
    </div>
    {#if f.refs?.carriers?.length || f.refs?.plmns?.length || f.refs?.mccs?.length}
      <div class="filters">
        {#each f.refs.carriers ?? [] as c, i (i)}<span class="chip">{c}</span>{/each}
        {#if f.refs.plmns?.length}<span class="dimtext">{f.refs.plmns.length} PLMNs</span>{/if}
        {#if f.refs.mccs?.length}<span class="dimtext">MCC {f.refs.mccs.join(" ")}</span>{/if}
      </div>
    {/if}
    {#if f.format === "xml" && f.text}
      <PolicyTree xml={f.text} />
      <button class="chip" onclick={() => (source = !source)}>{source ? "hide" : "show"} source</button>
      {#if source}<pre class="code">{f.text}</pre>{/if}
    {:else if f.text !== undefined}
      <pre class="code">{f.text}</pre>
    {:else}
      <p class="dimtext">Binary content.</p>
    {/if}
  </Pane>
</div>
