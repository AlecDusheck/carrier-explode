<script lang="ts">
  import Self from "./IntelNode.svelte";
  import IntelValueView from "./IntelValue.svelte";
  import Confidence from "./Confidence.svelte";
  import { isIntelNode, type IntelList, type IntelNode, type IntelTable } from "$lib/decode";

  let {
    node,
    depth = 0,
    notes = false,
    raw = false,
    epoch = 0,
    filtering = false,
    nested = false,
  }: {
    node: IntelNode;
    depth?: number;
    notes?: boolean;
    raw?: boolean;
    epoch?: number;
    filtering?: boolean;
    /** Inside a table cell: no twist, lists and PLMN tables inline. */
    nested?: boolean;
  } = $props();

  // A manual toggle only counts until the next expand-all or collapse-all.
  let toggled = $state<{ epoch: number; open: boolean } | null>(null);
  let showNote = $state(false);

  const big = $derived(node.kind === "table" ? node.rows.length > 30 : node.kind === "list" ? node.items.length > 30 : false);
  const auto = $derived(filtering || (node.kind === "group" ? depth < 2 : depth < 4 && !big));
  const override = $derived(toggled?.epoch === epoch ? toggled.open : null);
  const open = $derived(override ?? (epoch > 0 ? true : epoch < 0 ? false : auto));
  const note = $derived(node.kind === "group" ? node.note : undefined);
  const noteOn = $derived(notes || showNote);

  // A list of short values reads as one line; a decoded bitmap reads as its bands.
  const inlineList = $derived(node.kind === "list" && (nested || !!node.decoded || (node.items.length <= 16 && node.items.every((x) => !x.value.decoded || x.value.decoded.kind === "band"))));
  // PLMN tables whose only columns are mcc / mnc are a list of PLMNs.
  const plmnOnly = (t: IntelTable) => t.rows.every((r) => r.plmn) && t.columns.every((c) => c === "mcc" || c === "mnc");
  const cols = (t: IntelTable) => (raw || !t.rows.some((r) => r.plmn || r.mcc) ? t.columns : t.columns.filter((c) => c !== "mcc" && c !== "mnc"));
  const idx = (i: number[]) => i.map((x) => `[${x}]`).join("");
  const count = $derived(node.kind === "group" ? node.children.length : node.kind === "table" ? node.rows.length : node.kind === "list" ? node.items.length : 0);
  // Raw values show every slot; otherwise a fixed-size array's zero padding is summarised.
  const shown = (l: IntelList) => (raw ? l.items : l.items.slice(0, l.used));
</script>

{#snippet twist()}
  <button type="button" class="twist" aria-expanded={open} onclick={() => (toggled = { epoch, open: !open })}>{open ? "▾" : "▸"}</button>
{/snippet}

{#snippet unused(l: IntelList)}
  {#if !raw && l.used < l.items.length}<span class="dimtext"> +{l.items.length - l.used} unused</span>{/if}
{/snippet}

{#snippet table(t: IntelTable)}
  {@const c = cols(t)}
  {@const id = t.rows.some((r) => r.plmn || r.mcc)}
  <div class="hscroll">
    <table class="grid itable">
      <thead>
        <tr><th class="num">#</th>{#if id}<th>{t.rows.some((r) => r.plmn) ? "PLMN" : "MCC"}</th>{/if}{#each c as h (h)}<th>{h}</th>{/each}</tr>
      </thead>
      <tbody>
        {#each t.rows as r, ri (ri)}
          <tr>
            <td class="num mono">{r.index.join(",")}</td>
            {#if id}<td class="mono">{r.plmn ?? r.mcc ?? ""}</td>{/if}
            {#each c as h (h)}
              {@const cell = r.cells[h]}
              <td>
                {#if !cell}
                  <span class="dimtext">·</span>
                {:else if isIntelNode(cell)}
                  <Self node={cell} depth={depth + 1} {notes} {raw} {epoch} {filtering} nested />
                {:else}
                  <IntelValueView v={cell} {raw} bare />
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

{#if nested && node.kind === "table" && plmnOnly(node)}
  <span>{#each node.rows as r, i (i)}<span class="chip mono">{r.plmn}</span>{/each}</span>
{:else if nested && node.kind === "table"}
  {@render table(node)}
{:else if nested && node.kind === "list"}
  <span>{#each shown(node) as x, i (i)}{#if i}<span class="type comma">,</span>{/if}<IntelValueView v={x.value} {raw} bare />{/each}{@render unused(node)}</span>
{:else}
  <div>
    <div class="row">
      {#if node.kind === "leaf" || inlineList}<span class="twist" aria-hidden="true">·</span>{:else}{@render twist()}{/if}
      <span>
        {#if note}
          <!-- The name is the control: tap or click for its note. -->
          <button type="button" class="key doc" class:on={noteOn} aria-expanded={noteOn} onclick={() => (showNote = !showNote)}>{node.name}</button>
        {:else}
          <span class="key">{node.name}</span>
        {/if}
        {#if node.kind === "leaf"}
          <span class="type sep">=</span><IntelValueView v={node.value} {raw} />
        {:else if node.kind === "list" && inlineList}
          <span class="type">[{node.items.length}]</span><span class="type sep">=</span>
          {#if node.decoded}
            <IntelValueView v={{ raw: node.items.map((x) => x.value.raw).join(", "), text: "", decoded: node.decoded }} {raw} />
            {#if !raw}<span class="type"> ({node.items.map((x) => x.value.raw).join(", ")})</span>{/if}
          {:else}
            {#each shown(node) as x, i (i)}{#if i}<span class="type comma">,</span>{/if}<IntelValueView v={x.value} {raw} bare />{/each}{@render unused(node)}
          {/if}
        {:else if node.kind === "table"}
          <span class="type"> [] {count} {count === 1 ? "row" : "rows"}</span>
        {:else}
          <span class="type"> {node.kind === "list" ? "[]" : "{}"} {count}</span>
        {/if}
      </span>
    </div>

    {#if note && noteOn}
      <span class="note">{note.text}<Confidence c={note.confidence} /></span>
    {/if}

    {#if open && node.kind === "group"}
      <div class="children">
        {#each node.children as c (c.path)}
          <Self node={c} depth={depth + 1} {notes} {raw} {epoch} {filtering} />
        {/each}
      </div>
    {:else if open && node.kind === "table"}
      <div class="children">{@render table(node)}</div>
    {:else if open && node.kind === "list" && !inlineList}
      <div class="children">
        {#each shown(node) as x, i (i)}
          <div class="row"><span class="type idx">{idx(x.index)}</span><IntelValueView v={x.value} {raw} /></div>
        {/each}
        {#if !raw && node.used < node.items.length}<div class="row"><span class="dimtext">{node.items.length - node.used} unused (0)</span></div>{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .sep { margin: 0 0.5ch; }
  .comma { margin-right: 0.5ch; }
  .idx { white-space: nowrap; flex: none; }
  .doc {
    font: inherit; font-weight: bold; color: #1b3d6b; background: none; border: 0; padding: 0;
    text-decoration: underline dotted #8a93a6; text-underline-offset: 3px; cursor: help;
  }
  .doc.on { text-decoration-style: solid; }
  .itable { width: auto; min-width: 50%; margin: 2px 0 4px; }
  .itable td { font-family: var(--mono); }
  .itable th { position: static; }
  @media (max-width: 760px) {
    .doc { padding: 6px 0; margin: -6px 0; }
  }
</style>
