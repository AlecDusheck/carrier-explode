<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getBundle, getComparison } from "$lib/api/bundles.remote";
  import { bundleArgs, entryLabel, link, withParams } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";
  import BundleCompare from "$lib/components/BundleCompare.svelte";

  let { params } = $props();

  const sp = $derived(page.url.searchParams);
  const against = $derived(sp.get("against"));
  const file = $derived(sp.get("file"));
  const args = $derived({
    a: against ? { kind: params.kind, name: params.name, slug: against } : null,
    b: { kind: params.kind, name: params.name, slug: params.version },
    ...(file ? { path: file } : {}),
  });

  const set = (changes: Record<string, string | null>) =>
    goto(withParams(page.url, changes), { keepFocus: true, noScroll: true });

  /** The timeline runs newest first. */
  function notNewer(timeline: Array<{ slug: string }>, x: string, y: string) {
    const at = (slug: string) => timeline.findIndex((t) => t.slug === slug);
    return at(x) >= at(y);
  }

  function compareHref(av: string | undefined) {
    const q = new URLSearchParams({ a: params.name, ...(av ? { av } : {}), b: params.name, bv: params.version });
    if (file) q.set("file", file);
    return link("/compare") + "?" + q;
  }
</script>

<div class="scroll pad">
  <Pane>
    {@const bundle = await getBundle(bundleArgs(params))}
    {@const chosen = against ?? bundle.previous?.slug ?? ""}
    <div class="rowflex">
      <label class="lbl">
        Compare against
        <select
          name="against"
          value={chosen}
          onchange={(e) => set({ against: e.currentTarget.value === bundle.previous?.slug ? null : e.currentTarget.value })}
        >
          {#if !chosen}<option value="">pick a version</option>{/if}
          {#each bundle.timeline.filter((t) => t.slug !== bundle.entry.slug) as t (t.slug)}
            <option value={t.slug}>{entryLabel(t)}{t.slug === bundle.previous?.slug ? " (previous)" : ""}</option>
          {/each}
        </select>
      </label>
      <a href={compareHref(chosen || undefined)}>Compare with another bundle…</a>
    </div>
  </Pane>

  <Pane>
    {@const [bundle, cmp] = await Promise.all([getBundle(bundleArgs(params)), getComparison(args)])}
    {#if !cmp.a || !cmp.diff}
      <p class="dimtext">Oldest version held; pick another version to compare against.</p>
    {:else}
      {@const older = notNewer(bundle.timeline, cmp.a.entry.slug, cmp.b.entry.slug)}
      {#if file}
        <table class="grid" style="margin-top:8px">
          <tbody>
            <tr>
              <td class="k">File</td>
              <td><span class="mono">{file}</span> &middot; <a href={withParams(page.url, { file: null })}>whole bundle</a></td>
            </tr>
          </tbody>
        </table>
      {/if}
      <BundleCompare
        diff={cmp.diff}
        a={cmp.a}
        b={cmp.b}
        left={older ? "Before" : "Other"}
        right={older ? "After" : "This"}
        narrowHref={(path) => withParams(page.url, { file: path })}
      />
    {/if}
  </Pane>
</div>
