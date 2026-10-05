<script lang="ts">
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import type { BundleDiff, FileDiff } from "@carrier-explode/decode-ios";
  import { summariseDiff, type DiffKind } from "@carrier-explode/values";
  import { ROUTINE_LABEL, type RoutineReason } from "#lib/apple/routine-changes.ts";
  import { DIFF_CHIP } from "#lib/format.ts";
  import { toggleIn } from "#lib/ui-state.svelte.ts";
  import DiffRows from "../DiffRows.svelte";

  interface Props {
    diff: BundleDiff;
    /** A file of one side, by its path. */
    fileHref: (side: "a" | "b", path: string) => string;
    left: string;
    right: string;
    /** Link that narrows the comparison to one file. */
    narrowHref: (path: string) => string;
    /** Why a file's difference is routine; those are counted together rather than listed one by one. */
    routine?: ((f: FileDiff) => RoutineReason | undefined) | undefined;
  }

  let { diff, fileHref, left, right, narrowHref, routine }: Props = $props();

  const KINDS = ["changed", "added", "removed"] as const satisfies DiffKind[];

  const kinds = new SvelteSet<DiffKind>(KINDS);
  // Files opened or closed by hand.
  const toggled = new SvelteMap<string, boolean>();
  let query = $state("");

  const q = $derived(query.trim().toLowerCase());

  // A filter that names a routine file shows it like any other.
  const routineOf = (f: FileDiff) => (q ? undefined : routine?.(f));
  const folded = $derived(diff.files.flatMap((f) => {
    const why = routineOf(f);
    return why ? [{ f, why }] : [];
  }));
  // The kind buttons count what they list: routine files are counted with their group.
  const byKind = $derived(summariseDiff(diff.files.filter((f) => routineOf(f) === undefined)));
  const visible = $derived(
    diff.files
      .filter((f) => kinds.has(f.kind) && routineOf(f) === undefined)
      .map((f) => {
        const whole = !q || f.path.toLowerCase().includes(q);
        return { f, whole, rows: whole ? f.rows : f.rows.filter((r) => r.path.toLowerCase().includes(q)) };
      })
      .filter((x) => x.whole || x.rows.length),
  );
  // Few files open by default; a text filter opens whatever it matched.
  const auto = $derived(!!q || visible.length <= 6);
  const isOpen = (path: string) => toggled.get(path) ?? auto;
  const toggle = (path: string) => toggled.set(path, !isOpen(path));

  const total = (c: BundleDiff["counts"]) => c.added + c.removed + c.changed;
  const anchor = (path: string) => "file-" + path.replace(/[^\w.-]/g, "_");
</script>

{#snippet sideLink(side: "a" | "b", path: string, label: string)}
  <a class="chip" href={fileHref(side, path)}>{label}</a>
{/snippet}

{#if diff.files.length}
  <div class="filters">
    {#each KINDS.filter((k) => byKind[k]) as k (k)}
      <button class="btn" class:on={kinds.has(k)} aria-pressed={kinds.has(k)} onclick={() => toggleIn(kinds, k)}>
        {k.charAt(0).toUpperCase() + k.slice(1)} ({byKind[k]})
      </button>
    {/each}
    <input type="search" name="diff-filter" placeholder="filter by path" aria-label="Filter by path" bind:value={query} />
  </div>

  {#if folded.length}
    {@const reasons = [...new Set(folded.map((x) => x.why))]}
    <details class="more">
      <summary>Routine changes ({folded.length} files): {reasons.map((r) => ROUTINE_LABEL[r]).join(", ")}</summary>
      <table class="grid">
        <thead><tr><th>File</th><th>Kind</th><th>Why it is routine</th></tr></thead>
        <tbody>
          {#each folded as { f, why } (f.path)}
            <tr>
              <td class="mono"><a href={narrowHref(f.path)}>{f.path}</a></td>
              <td><span class="chip {DIFF_CHIP[f.kind]}">{f.kind}</span></td>
              <td class="dimtext">{ROUTINE_LABEL[why]}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </details>
  {/if}

  {#if visible.length > 1}
    <table class="grid gap-above">
      <thead><tr><th>File</th><th>Kind</th><th class="num">Added</th><th class="num">Removed</th><th class="num">Changed</th></tr></thead>
      <tbody>
        {#each visible as { f } (f.path)}
          <tr>
            <td class="mono">
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
        {#if f.kind !== "added"}{@render sideLink("a", f.path, left)}{/if}
        {#if f.kind !== "removed"}{@render sideLink("b", f.path, right)}{/if}
        {#if diff.files.length > 1}<a class="chip" href={narrowHref(f.path)}>only this file</a>{/if}
      </legend>
      <!-- Rendered closed as well, so every row is in the page and can be linked to. -->
      <div hidden={!open}>
        {#if rows.length}
          <DiffRows {rows} {left} {right} anchor={anchor(f.path)} />
          {#if !whole}<p class="dimtext after">{rows.length} of {f.rows.length} rows match.</p>{/if}
          {#if f.truncated}
            <p class="dimtext after">
              First {f.rows.length} of {total(f.counts)} rows{#if diff.files.length > 1}; <a href={narrowHref(f.path)}>narrow to this file</a> for more{/if}.
            </p>
          {/if}
        {:else if f.kind === "changed"}
          <span class="dimtext">Bytes differ; no decoded difference.</span>
        {:else}
          <span class="dimtext">Only in {f.kind === "added" ? right : left}.</span>
        {/if}
      </div>
    </fieldset>
  {:else}
    <p class="dimtext">{q ? "Nothing matches the filter." : folded.length ? "Only routine changes." : "Nothing to show."}</p>
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
