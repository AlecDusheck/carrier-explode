<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import type { BundleDiff, DiffKind } from "$lib/decode/compare";
  import type { Kind, PublicEntry } from "$lib/server/data";
  import { fileHref, shortValue } from "$lib/format";

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

  const KINDS = ["changed", "added", "removed"] as const;
  const CHIP: Record<DiffKind, string> = { added: "good", removed: "bad", changed: "warn", same: "" };

  const kinds = new SvelteSet<DiffKind>(KINDS);
  const flipped = new SvelteSet<string>();
  let query = $state("");

  const q = $derived(query.trim().toLowerCase());
  const byKind = $derived(Object.fromEntries(KINDS.map((k) => [k, diff.files.filter((f) => f.kind === k).length])));
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
  const isOpen = (path: string) => auto !== flipped.has(path);

  function toggle(path: string) {
    if (flipped.has(path)) flipped.delete(path);
    else flipped.add(path);
  }

  function setAll(open: boolean) {
    flipped.clear();
    if (open !== auto) for (const x of visible) flipped.add(x.f.path);
  }

  function toggleKind(k: DiffKind) {
    if (kinds.has(k)) kinds.delete(k);
    else kinds.add(k);
  }

  const full = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));
  const total = (c: BundleDiff["counts"]) => c.added + c.removed + c.changed;
  const anchor = (path: string) => "file-" + path.replace(/[^\w.-]/g, "_");
</script>

{#snippet value(v: unknown, present: boolean)}
  {#if !present}
    <span class="dimtext">absent</span>
  {:else}
    {@const s = shortValue(v, 300)}
    {#if s.length > 300}
      <details class="long">
        <summary>{s}</summary>
        <pre class="code">{full(v)}</pre>
      </details>
    {:else}
      {s}
    {/if}
  {/if}
{/snippet}

{#snippet sideLink(s: Side, path: string, label: string)}
  <a class="chip" href={fileHref(s.kind, s.name, s.entry.slug, path)}>{label}</a>
{/snippet}

{#if diff.files.length}
  {#if diff.counts.same}<p class="dimtext" style="margin:6px 0">{diff.counts.same} {diff.counts.same === 1 ? "file" : "files"} identical</p>{/if}
  <div class="rowflex">
    {#each KINDS as k (k)}
      <button class="btn" class:on={kinds.has(k)} aria-pressed={kinds.has(k)} onclick={() => toggleKind(k)}>
        {k[0].toUpperCase() + k.slice(1)} ({byKind[k]})
      </button>
    {/each}
    <input type="search" name="diff-filter" placeholder="filter by path" aria-label="Filter by path" class="grow" bind:value={query} />
    <button class="btn" onclick={() => setAll(true)}>Expand all</button>
    <button class="btn" onclick={() => setAll(false)}>Collapse all</button>
  </div>

  {#if diff.files.length > 1}
    <table class="grid" style="margin-top:8px">
      <thead><tr><th>File</th><th>Kind</th><th class="num">Added</th><th class="num">Removed</th><th class="num">Changed</th></tr></thead>
      <tbody>
        {#each visible as { f } (f.path)}
          <tr>
            <td class="mono wrap">
              <a href="#{anchor(f.path)}" onclick={() => isOpen(f.path) || toggle(f.path)}>{f.path}</a>
            </td>
            <td><span class="chip {CHIP[f.kind]}">{f.kind}</span></td>
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
        <span class="chip {CHIP[f.kind]}">{f.kind}</span>
        {#if f.kind === "changed"}<span class="dimtext">{total(f.counts)} {total(f.counts) === 1 ? "row" : "rows"}</span>{/if}
        {#if f.kind !== "added"}{@render sideLink(a, f.path, left)}{/if}
        {#if f.kind !== "removed"}{@render sideLink(b, f.path, right)}{/if}
        {#if narrowHref && diff.files.length > 1}<a class="chip" href={narrowHref(f.path)}>only this file</a>{/if}
      </legend>
      {#if open}
        {#if rows.length}
          <table class="grid">
            <thead><tr><th>Key path</th><th>{left}</th><th>{right}</th><th>Kind</th></tr></thead>
            <tbody>
              {#each rows as r, i (i)}
                <tr>
                  <td class="mono k wrap">{r.path || "(whole file)"}</td>
                  <td class="mono wrap">{@render value(r.a, r.kind !== "added")}</td>
                  <td class="mono wrap">{@render value(r.b, r.kind !== "removed")}</td>
                  <td><span class="chip {CHIP[r.kind]}">{r.kind}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if !whole}<p class="dimtext" style="margin:4px 0 0">{rows.length} of {f.rows.length} rows match.</p>{/if}
          {#if f.truncated}
            <p class="dimtext" style="margin:4px 0 0">
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
  details.long > summary { cursor: pointer; }
  details.long[open] > summary { color: var(--text-dim); }
</style>
