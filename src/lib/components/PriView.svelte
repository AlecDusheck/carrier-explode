<script lang="ts">
  import { dialectLabel, type PriDecoded } from "$lib/decode";
  import PriValueCell from "./PriValueCell.svelte";
  import Confidence from "./Confidence.svelte";
  import IntelView from "./IntelView.svelte";

  let { pri }: { pri: PriDecoded } = $props();

  let filter = $state("");

  const has = (f: string, ...xs: Array<string | undefined>) => xs.some((x) => x?.toLowerCase().includes(f));

  const pick = (q: string) => {
    const f = q.trim().toLowerCase();
    if (!f) return pri.efs;
    return pri.efs.filter((e) => has(f, e.path, e.value.text, e.name, e.meaning, e.label));
  };
  const efs = $derived(pick(filter));

  // Empty header fields ("Carrier ID" on most files) say nothing.
  const header = $derived(Object.entries(pri.header).filter(([, v]) => v !== ""));
  const unknown = $derived(pri.unknown.filter((u) => u.nv === undefined));
  // Items the NV tables do not describe carry only a placeholder name.
  const modem = $derived(dialectLabel(pri.dialect));
</script>

{#if pri.error}<div class="banner err">{pri.error}</div>{/if}

{#if header.length || modem}
  <fieldset class="hgroup">
    <legend>Header</legend>
    <table class="grid">
      <tbody>
        {#if modem}<tr><td class="k">Written for</td><td>{modem} modem</td></tr>{/if}
        {#each header as [k, v] (k)}
          <tr><td class="k">{k}</td><td class="mono">{v}</td></tr>
        {/each}
      </tbody>
    </table>
  </fieldset>
{/if}

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

{#snippet efsTable(rows: typeof pri.efs)}
  <table class="grid">
    <thead><tr><th class="setting">Setting</th><th>Value</th></tr></thead>
    <tbody>
      {#each rows as e, i (i)}
        <tr>
          <td>
            {#if e.name}<div><b>{e.name}</b><Confidence c={e.confidence} /></div>{/if}
            {#if e.meaning}<div class="dimtext">{e.meaning}</div>{/if}
            <div class="mono wrap path">{e.path}</div>
          </td>
          <td><PriValueCell v={e.value} label={e.label} /></td>
        </tr>
      {:else}
        <tr><td colspan="2" class="dimtext">No override pairs in this file.</td></tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet keyList(q: string)}
  {@render efsTable(pick(q))}
{/snippet}

<fieldset class="hgroup">
  <legend>Baseband overrides ({pri.efs.length})</legend>
  {#if pri.intel}
    <IntelView tree={pri.intel} flat={keyList} />
  {:else}
    <div class="filters">
      <input type="search" name="pri-filter" placeholder="filter" aria-label="filter overrides" bind:value={filter} />
      {#if filter.trim()}<span class="dimtext">{efs.length} shown</span>{/if}
    </div>
    {@render efsTable(efs)}
  {/if}
</fieldset>

{#if pri.nv.length}
  <fieldset class="hgroup">
    <legend>Legacy NV values ({pri.nv.length})</legend>
    <table class="grid">
      <thead><tr><th class="num">NV</th><th>Item</th><th>Value</th></tr></thead>
      <tbody>
        {#each pri.nv as n, i (i)}
          <tr>
            <td class="num mono">{n.item}</td>
            <td>
              {#if n.name}<b>{n.name}</b>{:else}<span class="dimtext">unnamed item</span>{/if}<Confidence c={n.confidence} />
              {#if n.meaning}<div class="dimtext">{n.meaning}</div>{/if}
            </td>
            <td><PriValueCell v={n.value} label={n.label} /></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </fieldset>
{/if}

{#if pri.featureGroups.length}
  <fieldset class="hgroup">
    <legend>Carrier Configuration Management feature groups</legend>
    <p class="dimtext note">25 one-byte flags per group; none are named.</p>
    <table class="grid">
      <thead><tr><th>Group</th><th>Flags</th></tr></thead>
      <tbody>
        {#each pri.featureGroups as g, i (i)}
          <tr>
            <td>
              <b>{g.name}</b><Confidence c={g.confidence} />
              <div class="dimtext">NV {g.nv}, {g.bits.length} of {g.total} set{g.boolean ? "" : ", some not 0/1"}</div>
            </td>
            <td>
              <div class="flags">
                {#each g.flags as x (x.index)}
                  <span
                    class="flag"
                    class:set={x.set}
                    class:odd={x.value > 1}
                    title="flag {x.index}{x.name ? ': ' + x.name : ''} = {x.value}"
                  >{x.index}</span>
                {/each}
              </div>
              {#each g.flags.filter((x) => x.set && x.name) as x (x.index)}
                <div>{x.index}: {x.name}<Confidence c={x.confidence} /></div>
              {/each}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </fieldset>
{/if}

{#if pri.nvListed.length}
  <details class="more">
    <summary>Legacy NV item list ({pri.nvListed.length})</summary>
    <p class="dimtext note">Green ones have a value above.</p>
    <div>
      {#each pri.nvListed as n, i (i)}
        <span class="chip" class:good={n.set} title={n.set ? "value present in this file" : "listed, no value in this file"}
          ><span class="mono">{n.item}</span>{#if n.name}{" "}{n.name}{/if}</span>
      {/each}
    </div>
  </details>
{:else if pri.nvItems.length}
  <details class="more">
    <summary>Legacy NV item list ({pri.nvItems.length})</summary>
    <p class="mono items">{pri.nvItems.join(", ")}</p>
  </details>
{/if}

{#if pri.schema.count}
  <details class="more">
    <summary>NV path schema index ({pri.schema.count} paths, {pri.schema.source})</summary>
    <pre class="code">{pri.schema.paths.join("\n")}</pre>
  </details>
{/if}

{#if unknown.length}
  <details class="more">
    <summary>Unidentified fields ({unknown.length})</summary>
    <table class="grid">
      <thead><tr><th>Tag</th><th class="num">n</th><th class="num">len</th><th>Value</th><th>Note</th></tr></thead>
      <tbody>
        {#each unknown as u (u.tag)}
          <tr>
            <td class="mono k">{u.tag}</td>
            <td class="num">{u.count}</td>
            <td class="num">{u.len}</td>
            <td class="mono wrap small">
              {u.ascii ? '"' + u.ascii + '"' : u.hex}{u.int !== undefined ? " (" + u.int + ")" : ""}
            </td>
            <td class="dimtext">{u.note ?? ""}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </details>
{/if}

<style>
  .setting { width: 58%; }
  .items { margin: 0; word-break: break-word; font-size: 11px; }
  td.small { font-size: 10px; }
  .path { font-size: 10.5px; word-break: break-all; }
  .flags { display: flex; flex-wrap: wrap; gap: 2px; margin-bottom: 3px; }
  .flag {
    font: 10px/16px var(--mono); width: 20px; text-align: center; color: var(--text-dim);
    border: 1px solid #c9c5bd; background: var(--field);
  }
  .flag.set { background: var(--good-bg); border-color: var(--good-border); color: var(--text); font-weight: bold; }
  .flag.odd { background: var(--warn-bg); border-color: var(--warn-border); }
</style>
