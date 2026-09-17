<script lang="ts">
  import Self from "./TreeNode.svelte";
  import { BITMASK_KEYS, KEY_NOTES, decodeBits, describeMessageId } from "$lib/knowledge";
  import { menuTrigger, copyText, scan, type MenuItem } from "$lib/ui-state.svelte";
  import { hexDump } from "$lib/format";
  import type { TreeCtx } from "./Tree.svelte";

  let {
    name,
    value,
    depth = 0,
    path,
    filter = "",
    epoch = 0,
    ctx,
    onfilter,
  }: {
    name: string;
    value: unknown;
    depth?: number;
    path: string;
    filter?: string;
    epoch?: number;
    ctx: TreeCtx;
    onfilter?: (p: string) => void;
  } = $props();

  const isBlob = (v: unknown): v is { __data: string; __len: number; __text?: string } =>
    !!v && typeof v === "object" && "__data" in v && "__len" in v;
  const isDate = (v: unknown): v is { __date: string } =>
    !!v && typeof v === "object" && "__date" in v;
  const isMap = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v) && !isBlob(v) && !isDate(v);

  // A manual toggle only counts until the next expand-all or collapse-all.
  let toggled = $state<{ epoch: number; open: boolean } | null>(null);
  let showHex = $state(false);

  const asArray = $derived(Array.isArray(value) ? (value as unknown[]) : null);
  const container = $derived(isMap(value) || !!asArray);
  const count = $derived(isMap(value) ? Object.keys(value).length : (asArray?.length ?? 0));
  const note = $derived(KEY_NOTES[name]);
  const bits = $derived(BITMASK_KEYS.has(name) && typeof value === "number" ? decodeBits(value) : null);
  const idHint = $derived(
    (name === "FromServiceID" || name === "ToServiceID") && typeof value === "number"
      ? describeMessageId(value)
      : undefined,
  );

  const override = $derived(toggled?.epoch === epoch ? toggled.open : null);
  const open = $derived(override ?? (epoch > 0 ? true : epoch < 0 ? false : depth < 2 || !!filter));

  const matches = $derived.by(() => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    if (name.toLowerCase().includes(f)) return true;
    try {
      return JSON.stringify(value).toLowerCase().includes(f);
    } catch {
      return false;
    }
  });

  function valueText(): string {
    if (isBlob(value)) return value.__text ?? value.__data;
    if (isDate(value)) return value.__date;
    return typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
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
      run: () => scan.start(path, ctx.file, "all", 60),
    });
    items.push({
      label: "Compare across countries",
      run: () => scan.start(path, ctx.file, "countries", 60),
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
        <span class="key">{name}</span>
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
          {:else if typeof value === "string"}
            <span class="val str">"{value}"</span>
          {:else if typeof value === "number"}
            <span class="val num">{value}</span>
          {:else if typeof value === "boolean"}
            <span class="val bool">{value}</span>
          {:else}
            <span class="val">{String(value)}</span>
          {/if}
        {/if}
        {#if bits}
          <span class="tag">bits {bits.length ? bits.join(", ") : "none"} &middot; 0x{(value as number).toString(16)}</span>
        {/if}
        {#if idHint}<span class="tag">{idHint}</span>{/if}
      </span>
    </div>

    {#if showHex && isBlob(value)}
      <pre class="code hex">{hexDump(value.__data)}</pre>
    {/if}

    {#if note}<span class="note">{note}</span>{/if}

    {#if container && open}
      <div class="children">
        {#if isMap(value)}
          {#each Object.entries(value) as [k, v] (k)}
            <Self name={k} value={v} depth={depth + 1} path={path + "." + k} {filter} {epoch} {ctx} {onfilter} />
          {/each}
        {:else if asArray}
          {#each asArray as v, i (i)}
            <Self name={"[" + i + "]"} value={v} depth={depth + 1} path={path + "[" + i + "]"} {filter} {epoch} {ctx} {onfilter} />
          {/each}
        {/if}
      </div>
    {/if}
  </div>
{/if}
