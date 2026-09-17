<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getBundle, getDiff, getIndex } from "$lib/api/bundles.remote";
  import type { Kind } from "$lib/server/data";
  import { entryLabel, withParams } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";
  import DiffTable from "$lib/components/DiffTable.svelte";

  const sp = $derived(page.url.searchParams);
  const file = $derived(sp.get("file") || "carrier.plist");

  const set = (changes: Record<string, string | null>) =>
    goto(withParams(page.url, changes), { keepFocus: true, noScroll: true });

  type Index = Awaited<ReturnType<typeof getIndex>>;
  const KINDS: Kind[] = ["carriers", "countries", "watch"];

  function side(idx: Index, name: string | null, slug: string | null) {
    if (!name) return null;
    const kind = KINDS.find((k) => idx[k].some((e) => e.name === name));
    return kind ? { kind, name, ...(slug ? { slug } : {}) } : null;
  }
</script>

<svelte:head><title>Compare · carrier-explode</title></svelte:head>

{#snippet picker(title: string, key: "a" | "b", chosen: ReturnType<typeof side>)}
  <fieldset class="hgroup">
    <legend>{title}</legend>
    <div class="rowflex">
      <input
        type="text"
        name={key}
        list="bundle-names"
        placeholder="bundle name"
        aria-label="{title} bundle"
        value={sp.get(key) ?? ""}
        onchange={(e) => set({ [key]: e.currentTarget.value.trim(), [key + "v"]: null })}
      />
      {#if chosen}
        <Pane>
          {@const bundle = await getBundle(chosen)}
          <select
            name="{key}v"
            class="grow"
            aria-label="{title} version"
            value={bundle.entry.slug}
            onchange={(e) => set({ [key + "v"]: e.currentTarget.value })}
          >
            {#each bundle.timeline as t (t.slug)}<option value={t.slug}>{entryLabel(t)}</option>{/each}
          </select>
        </Pane>
      {:else if sp.get(key)}
        <span class="dimtext">No such bundle</span>
      {/if}
    </div>
  </fieldset>
{/snippet}

<div class="view">
  <div class="scroll pad">
    <Pane>
      {@const idx = await getIndex()}
      {@const a = side(idx, sp.get("a"), sp.get("av"))}
      {@const b = side(idx, sp.get("b"), sp.get("bv"))}

      <datalist id="bundle-names">
        {#each KINDS as k (k)}{#each idx[k] as e (e.name)}<option value={e.name}></option>{/each}{/each}
      </datalist>

      {@render picker("Left", "a", a)}
      {@render picker("Right", "b", b)}

      <div class="rowflex">
        <label class="lbl">
          File
          <input type="text" name="file" value={file} style="min-width:220px" onchange={(e) => set({ file: e.currentTarget.value.trim() })} />
        </label>
      </div>

      {#if a && b}
        <Pane>
          {@const result = await getDiff({ a, b, path: file })}
          {#if result.shared.length > 1}
            <p style="margin:8px 0 0">
              {#each result.shared.slice(0, 60) as f (f)}
                <a class="chip mono" href={withParams(page.url, { file: f })} aria-current={f === file ? "true" : undefined}>{f}</a>
              {/each}
            </p>
          {/if}
          <fieldset class="hgroup">
            <legend>{result.counts.changed} changed, {result.counts.added} added, {result.counts.removed} removed</legend>
            {#if result.rows.length}
              <DiffTable rows={result.rows} left="Left" right="Right" />
            {:else}
              <span class="dimtext">Identical.</span>
            {/if}
          </fieldset>
        </Pane>
      {:else}
        <p class="dimtext">Pick two bundles, or one bundle at two versions.</p>
      {/if}
    </Pane>
  </div>
</div>
