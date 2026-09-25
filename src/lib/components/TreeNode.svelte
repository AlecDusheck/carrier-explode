<script lang="ts">
  import Self from "./TreeNode.svelte";
  import Confidence from "./Confidence.svelte";
  import { describeField, describeValue } from "$lib/decode";
  import { menuTrigger, copyText, scan, type MenuItem } from "$lib/ui-state.svelte";
  import { hexDump, isBigInt, isUid, plainJson } from "$lib/format";
  import type { TreeCtx } from "./Tree.svelte";

  let {
    name,
    value,
    depth = 0,
    path,
    filter = "",
    epoch = 0,
    notes = false,
    ctx,
    onfilter,
  }: {
    name: string;
    value: unknown;
    depth?: number;
    path: string;
    filter?: string;
    epoch?: number;
    notes?: boolean;
    ctx: TreeCtx;
    onfilter?: (p: string) => void;
  } = $props();

  const isBlob = (v: unknown): v is { __data: string; __len: number; __text?: string } =>
    !!v && typeof v === "object" && "__data" in v && "__len" in v;
  const isDate = (v: unknown): v is { __date: string } =>
    !!v && typeof v === "object" && "__date" in v;
  const isMap = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v) && !isBlob(v) && !isDate(v) && !isBigInt(v) && !isUid(v);

  // A manual toggle only counts until the next expand-all or collapse-all.
  let toggled = $state<{ epoch: number; open: boolean } | null>(null);
  let showHex = $state(false);
  let showNote = $state(false);

  const asArray = $derived(Array.isArray(value) ? (value as unknown[]) : null);
  const container = $derived(isMap(value) || !!asArray);
  const count = $derived(isMap(value) ? Object.keys(value).length : (asArray?.length ?? 0));
  // Array elements take their meaning from the array's key: SupportedSIMs[3], MessageIDs[0].
  const element = $derived(/^\[\d+\]$/.test(name));
  const key = $derived(element ? (path.replace(/(\[\d+\])+$/, "").split(".").pop() ?? name) : name);
  const doc = $derived(element ? undefined : describeField(name, path));
  const valueDoc = $derived(container ? undefined : element ? describeField(key, path) : doc);
  const num = $derived(typeof value === "number" ? value : isBigInt(value) ? BigInt(value.__int) : undefined);
  const labels = $derived(valueDoc ? describeValue(key, num ?? value, path) : undefined);
  const mask = $derived(!!valueDoc && (valueDoc.format === "bitmask" || (!!valueDoc.bits && !valueDoc.format)));
  const unit = $derived(num !== undefined ? valueDoc?.unit : undefined);

  const override = $derived(toggled?.epoch === epoch ? toggled.open : null);
  const open = $derived(override ?? (epoch > 0 ? true : epoch < 0 ? false : depth < 2 || !!filter));

  const matches = $derived.by(() => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    if (name.toLowerCase().includes(f)) return true;
    if (labels?.some((l) => l.toLowerCase().includes(f))) return true;
    try {
      return JSON.stringify(value).toLowerCase().includes(f);
    } catch {
      return false;
    }
  });

  function valueText(): string {
    if (isBlob(value)) return value.__text ?? value.__data;
    if (isDate(value)) return value.__date;
    if (isBigInt(value)) return value.__int;
    return typeof value === "string" ? value : plainJson(value);
  }

  function buildMenu(): { title: string; items: MenuItem[] } {
    const items: MenuItem[] = [];
    if (ctx.cc) {
      items.push({
        label: "Compare across " + ctx.cc.toUpperCase() + " carriers",
        run: () => scan.start(path, ctx.file, "country:" + ctx.cc),
      });
    }
    items.push({
      label: "Compare across all carriers",
      run: () => scan.start(path, ctx.file, "all"),
    });
    items.push({
      label: "Compare across countries",
      run: () => scan.start(path, ctx.file, "countries"),
    });
    items.push({ label: "", separator: true });
    items.push({ label: "Copy key path", run: () => copyText(path) });
    items.push({ label: "Copy value", run: () => copyText(valueText()) });
    if (onfilter) items.push({ label: "Filter tree to this key", run: () => onfilter(name) });
    return { title: path, items };
  }
</script>

{#if matches}
  <div>
    <div class="row" {@attach menuTrigger(buildMenu)}>
      {#if container}
        <button type="button" class="twist" aria-expanded={open} onclick={() => (toggled = { epoch, open: !open })}
        >{open ? "▾" : "▸"}</button>
      {:else}
        <span class="twist" aria-hidden="true">·</span>
      {/if}
      <span>
        {#if doc}
          <!-- The key is the control: tap or click for its note; long-press stays the menu. -->
          <button type="button" class="key doc" class:on={notes || showNote} aria-expanded={notes || showNote}
            onclick={() => (showNote = !showNote)}>{name}</button>
        {:else}
          <span class="key">{name}</span>
        {/if}
        {#if container}
          <span class="type"> {isMap(value) ? "{}" : "[]"} {count}</span>
        {:else}
          <span class="type"> = </span>
          {#if value === null}
            <span class="val nul">null</span>
          {:else if isBlob(value)}
            <span class="val">
              {value.__text ? '"' + value.__text + '"' : value.__len + " bytes"}
              <button class="chip" onclick={() => (showHex = !showHex)}>{showHex ? "hide" : "hex"}</button>
            </span>
          {:else if isDate(value)}
            <span class="val str">{value.__date}</span>
          {:else if isBigInt(value)}
            <span class="val num" title="integer beyond 2^53, shown exactly">{value.__int}</span>
          {:else if isUid(value)}
            <span class="val uid" title="keyed-archive object reference">UID {value.__uid}</span>
          {:else if typeof value === "string"}
            <span class="val str">"{value}"</span>
          {:else if typeof value === "number"}
            <span class="val num">{value}</span>
          {:else if typeof value === "boolean"}
            <span class="val bool">{value}</span>
          {:else}
            <span class="val">{String(value)}</span>
          {/if}
          {#if unit}<span class="type"> {unit}</span>{/if}
        {/if}
        {#if labels && mask}
          <span class="type sep">=</span>
          <span class="meaning">
            {#each labels as l, i (i)}{#if i}<span class="type sep">·</span>{/if}<span class:unnamed={/^bit \d+$/.test(l)}>{l}</span>{:else}<span class="dimtext">no bits set</span>{/each}
          </span>
          <span class="type hex">0x{num?.toString(16)}</span>
          <Confidence c={valueDoc?.confidence} />
        {:else if labels}
          {#if labels.length}
            <span class="type sep">=</span><span class="meaning">{labels.join(" · ")}</span>
          {:else}
            <span class="meaning dimtext">(not a listed value)</span>
          {/if}
          <Confidence c={valueDoc?.confidence} />
        {/if}
      </span>
    </div>

    {#if showHex && isBlob(value)}
      <pre class="code hex">{hexDump(value.__data)}</pre>
    {/if}

    {#if doc && (notes || showNote)}
      <span class="note">
        {doc.note}{doc.default !== undefined ? " Default " + doc.default + (doc.unit ? " " + doc.unit : "") + "." : ""}
        <Confidence c={doc.confidence} />
      </span>
    {/if}

    {#if container && open}
      <div class="children">
        {#if isMap(value)}
          {#each Object.entries(value) as [k, v] (k)}
            <Self name={k} value={v} depth={depth + 1} path={path + "." + k} {filter} {epoch} {notes} {ctx} {onfilter} />
          {/each}
        {:else if asArray}
          {#each asArray as v, i (i)}
            <Self name={"[" + i + "]"} value={v} depth={depth + 1} path={path + "[" + i + "]"} {filter} {epoch} {notes} {ctx} {onfilter} />
          {/each}
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .doc {
    font: inherit; font-weight: bold; color: #1b3d6b; background: none; border: 0; padding: 0;
    text-decoration: underline dotted #8a93a6; text-underline-offset: 3px; cursor: help;
  }
  .doc.on { text-decoration-style: solid; }
  .meaning { font-family: var(--ui); font-size: 11px; color: #5b3d0c; }
  .unnamed { color: var(--text-dim); white-space: nowrap; }
  .sep { margin: 0 0.5ch; }
  .hex { margin-left: 1ch; white-space: nowrap; }
  .uid { color: #6a2f8a; border: 1px dotted #a98ac0; padding: 0 3px; }
  @media (max-width: 760px) {
    .doc { padding: 6px 0; margin: -6px 0; }
  }
</style>
