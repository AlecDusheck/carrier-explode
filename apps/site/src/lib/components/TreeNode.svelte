<script lang="ts">
  import Self from "./TreeNode.svelte";
  import Confidence from "./Confidence.svelte";
  import { isBigInt, isBlob, isDate, isJsonDict, isUid } from "@carrier-explode/decode-ios";
  import { menuTrigger, copyText, scanMenuItems, type MenuItem } from "#lib/ui-state.svelte.ts";
  import { hexDump, plainJson } from "#lib/format.ts";
  import { onKeyPath, searchTerms } from "#lib/settings.ts";
  import type { KeyBadge, TreeCtx } from "./Tree.svelte";
  import LazyView from "./values/LazyView.svelte";
  import NotUnderstood from "./values/NotUnderstood.svelte";
  import TreeRow from "./TreeRow.svelte";
  import { configView } from "./android/config/views.ts";

  interface Props {
    name: string;
    value: unknown;
    depth?: number;
    path: string;
    filter: string;
    ctx: TreeCtx;
    onfilter: (p: string) => void;
    badges?: KeyBadge[] | undefined;
    /** An ancestor matches the filter itself, so this node shows whatever it holds. */
    within?: boolean;
  }

  let { name, value, depth = 0, path, filter, ctx, onfilter, badges, within = false }: Props = $props();

  const docs = $derived(ctx.docs);

  let showHex = $state(false);
  let showNote = $state(false);
  let showRaw = $state(false);

  const asArray = $derived(Array.isArray(value) ? value : null);
  const container = $derived(isJsonDict(value) || !!asArray);
  const count = $derived(isJsonDict(value) ? Object.keys(value).length : (asArray?.length ?? 0));
  // Array elements take their meaning from the array's key: SupportedSIMs[3], MessageIDs[0].
  const element = $derived(/^\[\d+\]$/.test(name));
  const key = $derived(element ? (path.replace(/(\[\d+\])+$/, "").split(".").pop() ?? name) : name);
  const doc = $derived(element ? undefined : docs.field(name, path));
  const valueDoc = $derived(container ? undefined : element ? docs.field(key, path) : doc);
  const num = $derived(typeof value === "number" ? value : isBigInt(value) ? BigInt(value.__int) : undefined);
  const labels = $derived(valueDoc ? docs.value(key, num ?? value, path) : undefined);
  const mask = $derived(!!valueDoc && (valueDoc.format === "bitmask" || (!!valueDoc.bits && !valueDoc.format)));
  const unit = $derived(num !== undefined ? valueDoc?.unit : undefined);

  const reading = $derived(element ? null : (docs.read(name, path, value) ?? null));
  // A value read in its format shows as its view, the raw value a click away.
  const view = $derived(reading?.kind === "decoded" && !showRaw ? configView(reading.decoded) : null);
  const folds = $derived(container || !!view);

  // The filter text and the key words of the feature it names ("VoNR", "Wi-Fi Calling").
  const terms = $derived(searchTerms(filter));
  const hit = (s: string): boolean => terms.some((t) => s.toLowerCase().includes(t));
  /** The node itself matches: its key, its meaning, a leaf's value, or a key path at or above it. Then all it holds shows. */
  const own = $derived(
    within ||
      !terms.length ||
      hit(name) ||
      !!labels?.some((l) => hit(l.label)) ||
      (!container && hit(JSON.stringify(value))) ||
      terms.some((t) => onKeyPath(t, path) === "at"),
  );
  /** Something it holds matches, so it shows as the path down to that. */
  const matches = $derived(own || hit(JSON.stringify(value)) || terms.some((t) => onKeyPath(t, path) === "above"));

  function valueText(): string {
    if (isBlob(value)) return value.__text ?? value.__data;
    if (isDate(value)) return value.__date;
    if (isBigInt(value)) return value.__int;
    return typeof value === "string" ? value : plainJson(value);
  }

  function buildMenu(): { title: string; items: MenuItem[] } {
    return {
      title: path,
      items: [
        ...scanMenuItems(ctx.platform, path, ctx.file, ctx.cc ?? null),
        { kind: "separator" },
        { kind: "action", label: "Copy key path", run: () => copyText(path) },
        { kind: "action", label: "Copy value", run: () => copyText(valueText()) },
        { kind: "action", label: "Filter tree to this key", run: () => onfilter(name) },
      ],
    };
  }
</script>

{#snippet line()}
  {#if doc}
    <button type="button" class="key doc" class:on={showNote} aria-expanded={showNote}
      onclick={() => (showNote = !showNote)}>{name}</button>
  {:else}
    <span class="key">{name}</span>
  {/if}
  {#each badges ?? [] as b (b.text)}<span class="badge {b.tone ?? ''}" title={b.title}>{b.text}</span>{/each}
  {#if reading?.kind === "decoded"}
    <button type="button" class="chip sp" onclick={() => (showRaw = !showRaw)}>{showRaw ? "decoded" : "raw"}</button>
  {/if}
  {#if container}
    <span class="type"> {isJsonDict(value) ? "{}" : "[]"} {count}</span>
  {:else if !view}
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
      {#each labels as l, i (i)}{#if i}<span class="type sep">·</span>{/if}<span class:unnamed={!l.named}>{l.label}</span>{:else}<span class="dimtext">no bits set</span>{/each}
    </span>
    <span class="type hex">0x{num?.toString(16)}</span>
    <Confidence c={valueDoc?.confidence} />
  {:else if labels}
    {#if labels.length}
      <span class="type sep">=</span><span class="meaning">{labels.map((l) => l.label).join(" · ")}</span>
    {:else}
      <span class="meaning dimtext">(not a listed value)</span>
    {/if}
    <Confidence c={valueDoc?.confidence} />
  {/if}
  {#if reading?.kind === "not-understood"}<NotUnderstood reason={reading.reason} />{/if}
{/snippet}

{#snippet under()}
  {#if showHex && isBlob(value)}
    <pre class="code hex">{hexDump(value.__data)}</pre>
  {/if}
  {#if doc && showNote}
    <span class="note">
      {doc.note}{doc.default !== undefined ? " Default " + doc.default + (doc.unit ? " " + doc.unit : "") + "." : ""}
      <Confidence c={doc.confidence} />
    </span>
  {/if}
{/snippet}

{#snippet body()}
  {#if view}
    <LazyView {view} />
  {:else if isJsonDict(value)}
    {#each Object.entries(value) as [k, v] (k)}
      <Self name={k} value={v} depth={depth + 1} path={path + "." + k} {filter} {ctx} {onfilter} within={own && !!terms.length} />
    {/each}
  {:else if asArray}
    {#each asArray as v, i (i)}
      <Self name={"[" + i + "]"} value={v} depth={depth + 1} path={path + "[" + i + "]"} {filter} {ctx} {onfilter} within={own && !!terms.length} />
    {/each}
  {/if}
{/snippet}

{#if matches}
  <TreeRow {line} {under} body={folds ? body : undefined} open={depth < 2 || !!filter} menu={menuTrigger(buildMenu)} />
{/if}

<style>
  .unnamed { color: var(--text-dim); white-space: nowrap; }
  .hex { margin-left: 1ch; white-space: nowrap; }
  .uid { color: #6a2f8a; border: 1px dotted #a98ac0; padding: 0 3px; }
</style>
