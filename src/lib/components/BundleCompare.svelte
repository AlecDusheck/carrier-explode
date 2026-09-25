<script lang="ts">
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { summariseDiff, type BundleDiff, type DiffKind } from "$lib/decode";
  import type { Kind, PublicEntry } from "$lib/types";
  import { DIFF_CHIP, fileHref } from "$lib/format";
  import { Folding, toggleIn, type FoldToggle } from "$lib/ui-state.svelte";
  import DiffRows from "./DiffRows.svelte";

  interface Side { kind: Kind; name: string; entry: PublicEntry }

  let { diff, a, b, left = "Before", right = "After", narrowHref }: {
    diff: BundleDiff;
    a: Side;
    b: Side;
    left?: string;
    right?: string;
    /** Link that narrows the comparison to one file. */
    narrowHref?: (path: string) => string;
  } = $props();

  const KINDS = ["changed", "added", "removed"] as const satisfies DiffKind[];

  const kinds = new SvelteSet<DiffKind>(KINDS);
  const fold = new Folding();
  const toggled = new SvelteMap<string, FoldToggle>();
  let query = $state("");

  const q = $derived(query.trim().toLowerCase());
  const byKind = $derived(summariseDiff(diff.files));
  const visible = $derived(
    diff.files
      .filter((f) => kinds.has(f.kind))
      .map((f) => {
        const whole = !q || f.path.toLowerCase().includes(q);
        return { f, whole, rows: whole ? f.rows : f.rows.filter((r) => r.path.toLowerCase().includes(q)) };
      })
      .filter((x) => x.whole || x.rows.length),
  );
  // Few files open by default; a text filter opens whatever it matched.
  const auto = $derived(!!q || diff.files.length <= 6);
  // Version stamps and signature digests change with every build; they start closed.
  const routine = (path: string) => /^(Info|version)\.plist$|^signatures\//.test(path);
  const isOpen = (path: string) => fold.openFor(auto && (!!q || !routine(path)), toggled.get(path));
  const toggle = (path: string) => toggled.set(path, fold.toggle(!isOpen(path)));

  const total = (c: BundleDiff["counts"]) => c.added + c.removed + c.changed;
  const anchor = (path: string) => "file-" + path.replace(/[^\w.-]/g, "_");
</script>

{#snippet sideLink(s: Side, path: string, label: string)}
  <a class="chip" href={fileHref(s.kind, s.name, s.entry.slug, path)}>{label}</a>
{/snippet}

{#if diff.files.length}
  <div class="filters">
    {#each KINDS as k (k)}
      <button class="btn" class:on={kinds.has(k)} aria-pressed={kinds.has(k)} onclick={() => toggleIn(kinds, k)}>
        {k[0].toUpperCase() + k.slice(1)} ({byKind[k]})
      </button>
    {/each}
    <input type="search" name="diff-filter" placeholder="filter by path" aria-label="Filter by path" bind:value={query} />
    <button class="btn" onclick={() => fold.expandAll()}>Expand all</button>
    <button class="btn" onclick={() => fold.collapseAll()}>Collapse all</button>
  </div>

  {#if diff.files.length > 1}
    <table class="grid gap-above">
      <thead><tr><th>File</th><th>Kind</th><th class="num">Added</th><th class="num">Removed</th><th class="num">Changed</th></tr></thead>
      <tbody>
        {#each visible as { f } (f.path)}
          <tr>
            <td class="mono wrap">
              <a href="#{anchor(f.path)}" onclick={() => isOpen(f.path) || toggle(f.path)}>{f.path}</a>
            </td>
            <td><span class="chip {DIFF_CHIP[f.kind]}">{f.kind}</span></td>
            <td class="num">{f.counts.added || ""}</td>
            <td class="num">{f.counts.removed || ""}</td>
            <td class="num">{f.counts.changed || ""}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#each visible as { f, rows, whole } (f.path)}
    {@const open = isOpen(f.path)}
    <fieldset class="hgroup" class:shut={!open} id={anchor(f.path)}>
      <legend class="rowflex">
        <button class="twist" aria-expanded={open} aria-label="{open ? 'Collapse' : 'Expand'} {f.path}" onclick={() => toggle(f.path)}>
          {open ? "▾" : "▸"}
        </button>
        <span class="mono">{f.path}</span>
        <span class="chip {DIFF_CHIP[f.kind]}">{f.kind}</span>
        {#if f.kind === "changed"}<span class="dimtext">{total(f.counts)} {total(f.counts) === 1 ? "row" : "rows"}</span>{/if}
        {#if f.kind !== "added"}{@render sideLink(a, f.path, left)}{/if}
        {#if f.kind !== "removed"}{@render sideLink(b, f.path, right)}{/if}
        {#if narrowHref && diff.files.length > 1}<a class="chip" href={narrowHref(f.path)}>only this file</a>{/if}
      </legend>
      {#if open}
        {#if rows.length}
          <DiffRows {rows} {left} {right} />
          {#if !whole}<p class="dimtext after">{rows.length} of {f.rows.length} rows match.</p>{/if}
          {#if f.truncated}
            <p class="dimtext after">
              First {f.rows.length} of {total(f.counts)} rows{#if narrowHref && diff.files.length > 1}; <a href={narrowHref(f.path)}>narrow to this file</a> for more{/if}.
            </p>
          {/if}
        {:else if f.kind === "changed"}
          <span class="dimtext">Bytes differ; no decoded difference.</span>
        {:else}
          <span class="dimtext">Only in {f.kind === "added" ? right : left}.</span>
        {/if}
      {/if}
    </fieldset>
  {:else}
    <p class="dimtext">Nothing matches the filter.</p>
  {/each}
{:else}
  <p class="dimtext">Identical.</p>
{/if}

<style>
  legend.rowflex { gap: 4px; }
  fieldset.shut { padding-bottom: 0; }
  .twist {
    font: inherit; background: none; border: 0; padding: 0 2px; cursor: pointer;
    color: var(--text-dim); width: 16px;
  }
  .after { margin: 4px 0 0; }
</style>
