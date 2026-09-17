<script lang="ts">
  import type { PriDecoded, PriValue } from "../../worker/lib/pri.ts";
  import PriValueCell from "./PriValueCell.svelte";

  let { pri }: { pri: PriDecoded } = $props();

  let filter = $state("");
  let showSchema = $state(false);

  const efs = $derived.by(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return pri.efs;
    return pri.efs.filter((e) => e.path.toLowerCase().includes(f) || e.value.text.toLowerCase().includes(f));
  });

  const header = $derived(Object.entries(pri.header) as Array<[string, string]>);
  const _typecheck: PriValue | undefined = undefined;
  void _typecheck;
</script>

{#if pri.error}<div class="banner err">{pri.error}</div>{/if}

<fieldset class="hgroup">
  <legend>Header</legend>
  <table class="grid">
    <tbody>
      {#each header as [k, v] (k)}
        <tr><td class="k">{k}</td><td class="mono">{v === "" ? "empty" : v}</td></tr>
      {/each}
      <tr><td class="k">Container</td><td>DER, {pri.leafCount} leaf fields, {pri.kind}</td></tr>
    </tbody>
  </table>
</fieldset>

{#if pri.named.length}
  <fieldset class="hgroup">
    <legend>Named settings ({pri.named.length})</legend>
    <table class="grid">
      <thead><tr><th>Name</th><th>Value</th></tr></thead>
      <tbody>
        {#each pri.named as n, i (i)}
          <tr><td class="k">{n.name}</td><td><PriValueCell v={n.value} /></td></tr>
        {/each}
      </tbody>
    </table>
  </fieldset>
{/if}

<fieldset class="hgroup">
  <legend>Baseband overrides ({pri.efs.length})</legend>
  <p class="dimtext" style="margin:0 0 6px">
    Assigned values: each Qualcomm EFS/NV path, or <span class="mono">%u:dyn_cps.*</span> dynamic config
    key, with the value this bundle writes into the modem.
  </p>
  <div class="rowflex" style="margin-bottom:6px">
    <input class="grow" type="search" placeholder="filter paths and values" bind:value={filter} />
    <span class="dimtext">{efs.length} shown</span>
  </div>
  <table class="grid">
    <thead><tr><th style="width:58%">Path</th><th>Value</th></tr></thead>
    <tbody>
      {#each efs as e, i (i)}
        <tr><td class="mono wrap">{e.path}</td><td><PriValueCell v={e.value} /></td></tr>
      {:else}
        <tr><td colspan="2" class="dimtext">No override pairs in this file.</td></tr>
      {/each}
    </tbody>
  </table>
</fieldset>

{#if pri.featureGroups.length}
  <fieldset class="hgroup">
    <legend>Carrier Configuration Management feature groups</legend>
    <table class="grid">
      <thead><tr><th>Group</th><th>Bits set</th><th>Raw</th></tr></thead>
      <tbody>
        {#each pri.featureGroups as g, i (i)}
          <tr>
            <td class="k">{g.name}</td>
            <td>
              {#each g.bits as b (b)}<span class="chip good">{b}</span>{:else}<span class="dimtext">none of 25</span>{/each}
            </td>
            <td class="mono wrap dimtext" style="font-size:10px">{g.hex}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </fieldset>
{/if}

{#if pri.nvItems.length}
  <fieldset class="hgroup">
    <legend>Legacy NV item list ({pri.nvItems.length})</legend>
    <p class="mono" style="margin:0; word-break:break-word; font-size:11px">{pri.nvItems.join(", ")}</p>
  </fieldset>
{/if}

{#if pri.schema.count}
  <fieldset class="hgroup">
    <legend>NV path schema index ({pri.schema.count}, {pri.schema.source})</legend>
    <div class="banner">
      These are the NV paths the PRI format knows about, a schema index rather than a list of assigned
      overrides. They carry no values. What this bundle actually writes is under Baseband overrides.
    </div>
    <button class="btn" onclick={() => (showSchema = !showSchema)}>
      {showSchema ? "Hide" : "Show"} {pri.schema.count} paths
    </button>
    {#if showSchema}<pre class="code">{pri.schema.paths.join("\n")}</pre>{/if}
  </fieldset>
{/if}

{#if pri.unknown.length}
  <fieldset class="hgroup">
    <legend>Unidentified fields ({pri.unknown.length})</legend>
    <p class="dimtext" style="margin:0 0 6px">
      Private ASN.1 tags whose meaning is not established. Shown raw rather than hidden.
    </p>
    <table class="grid">
      <thead><tr><th>Tag</th><th class="num">n</th><th class="num">len</th><th>Value</th><th>Note</th></tr></thead>
      <tbody>
        {#each pri.unknown as u (u.tag)}
          <tr>
            <td class="mono k">{u.tag}</td>
            <td class="num">{u.count}</td>
            <td class="num">{u.len}</td>
            <td class="mono wrap" style="font-size:10px">
              {u.ascii ? '"' + u.ascii + '"' : u.hex}{u.int !== undefined ? " (" + u.int + ")" : ""}
            </td>
            <td class="dimtext">{u.note ?? ""}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </fieldset>
{/if}
